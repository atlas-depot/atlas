#!/usr/bin/env python3
"""One-way issue mirror. No third-party dependencies; no write retries."""
import argparse
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

REPO = 'atlas-depot/atlas'
LIST = '1100380000082079'
WORKSPACE = '1100380000018105'
SEEDS = json.loads(Path(__file__).with_name('clickup-seeds.json').read_text())


class SyncError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise SyncError('API redirect refused')


class API:
    def __init__(self, service, token):
        self.base = {'github': 'https://api.github.com',
                     'clickup': 'https://api.clickup.com/api/v2'}[service]
        self.token = ('Bearer ' if service == 'github' else '') + token
        self.opener = urllib.request.build_opener(NoRedirect)

    def request(self, method, path, body=None):
        if not path.startswith('/') or path.startswith('//'):
            raise SyncError('Invalid API path')
        request = urllib.request.Request(self.base + path, method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={'Authorization': self.token, 'Content-Type': 'application/json',
                     'Accept': 'application/json', 'User-Agent': 'atlas-issue-sync'})
        for attempt in range(3):
            try:
                with self.opener.open(request, timeout=30) as response:
                    return json.load(response)
            except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as error:
                status = getattr(error, 'code', None)
                if method == 'GET' and attempt < 2 and (status is None or status == 429 or status >= 500):
                    time.sleep(2 ** (attempt + 1))
                    continue
                raise SyncError(f'{method} request failed (HTTP {status or "unavailable"}); '
                                'write outcome may be unknown; reconcile before retrying') from None
            except (ValueError, OSError):
                raise SyncError(f'{method} returned an unreadable response; reconcile before retrying') from None


def issues(github):
    result = []
    for page in range(1, 1001):
        batch = github.request('GET', f'/repos/{REPO}/issues?state=all&per_page=100&page={page}')
        result.extend(i for i in batch if 'pull_request' not in i)
        if len(batch) < 100:
            return result
    raise SyncError('GitHub pagination limit exceeded')


def tasks(clickup):
    result = {}
    for archived in ('false', 'true'):
        for page in range(1000):
            data = clickup.request('GET', f'/list/{LIST}/task?include_closed=true&subtasks=true'
                                   f'&archived={archived}&page={page}&include_markdown_description=true')
            batch = data['tasks']
            result.update((t['id'], t) for t in batch)
            if data.get('last_page') is True or not batch:
                break
        else:
            raise SyncError('ClickUp pagination limit exceeded')
    return result


def resolve_users(raw, workspace):
    users = [m['user'] for m in workspace['members']]
    resolved = {}
    for login, value in raw.items():
        matches = [u for u in users if (str(u['id']) == str(value) if str(value).isdigit()
                   else u.get('email', '').casefold() == str(value).casefold())]
        if len(matches) != 1:
            raise SyncError('Assignee map contains an unknown or ambiguous workspace member')
        resolved[login.casefold()] = int(matches[0]['id'])
    return resolved


def source_url(number):
    return f'https://github.com/{REPO}/issues/{number}'


def source_numbers(task, legacy=False):
    # Only the leading identity, never a source-like line inside the issue body.
    numbers = set()
    for key in ('markdown_description', 'text_content', 'description'):
        lines = [line.strip() for line in (task.get(key) or '').splitlines() if line.strip()]
        if legacy and lines and lines[0].startswith('Owner:'):
            lines = lines[1:]
        if not lines:
            continue
        prefix = r'(?:Source|GitHub task)' if legacy else 'Source'
        match = re.fullmatch(prefix + rf':\s*<?https://github\.com/{re.escape(REPO)}/issues/(\d+)>?', lines[0])
        if match:
            numbers.add(int(match[1]))
    return numbers


def plan(issue, task, users, open_status, closed_status):
    logins = [u['login'].casefold() for u in issue['assignees']]
    if any(login not in users for login in logins):
        raise SyncError(f'Issue #{issue["number"]}: missing assignee mapping')
    wanted = sorted({users[login] for login in logins})
    content = f'Source: {source_url(issue["number"])}\n\n{issue.get("body") or ""}'
    payload = {'name': issue['title'], 'markdown_content': content}
    if task is None:
        return dict(payload, assignees=wanted,
                    status=closed_status if issue['state'] == 'closed' else open_status,
                    check_required_custom_fields=True)
    current = {int(u['id']) for u in task['assignees']}
    payload['assignees'] = {'add': sorted(set(wanted) - current), 'rem': sorted(current - set(wanted))}
    if not payload['assignees']['add'] and not payload['assignees']['rem']:
        del payload['assignees']
    if task['name'] == payload['name']:
        del payload['name']
    if task.get('markdown_description') == content:
        del payload['markdown_content']
    state = task['status']
    if issue['state'] == 'closed' and state['status'].casefold() != closed_status.casefold():
        payload['status'] = closed_status
    elif issue['state'] == 'open' and state['type'] in ('closed', 'done'):
        payload['status'] = open_status
    return payload


def reconcile(github, clickup, raw_users, dry_run, seeds=SEEDS):
    teams = clickup.request('GET', '/team')['teams']
    matches = [t for t in teams if str(t['id']) == WORKSPACE]
    if len(matches) != 1:
        raise SyncError('Configured workspace is not accessible')
    users = resolve_users(raw_users, matches[0])
    metadata = clickup.request('GET', f'/list/{LIST}')
    statuses = metadata['statuses']
    open_matches = [s['status'] for s in statuses if s['status'].casefold() == 'backlog' and s['type'] not in ('closed', 'done')]
    closed_matches = [s['status'] for s in statuses if s['type'] == 'closed']
    if len(open_matches) != 1 or len(closed_matches) != 1:
        raise SyncError('List must have one backlog status and one closed status')
    inventory = tasks(clickup)
    index = {}
    for task in inventory.values():
        for number in source_numbers(task):
            index.setdefault(number, set()).add(task['id'])
    for number, task_id in seeds.items():
        # Explicit mapping must remain in its configured home List.
        if task_id not in inventory:
            raise SyncError(f'Seed for issue #{number} is missing or outside the configured List')
        task = inventory[task_id]
        if source_numbers(task, legacy=True) != {int(number)}:
            raise SyncError(f'Seed for issue #{number} lacks its canonical GitHub URL')
        index.setdefault(int(number), set()).add(task_id)
    if any(len(ids) != 1 for ids in index.values()) or len({next(iter(ids)) for ids in index.values()}) != len(index):
        raise SyncError('Duplicate issue mappings found; refusing all writes')
    work = []
    for issue in issues(github):
        ids = index.get(issue['number'], set())
        task = inventory[next(iter(ids))] if ids else None
        if task is None and issue['state'] == 'closed':
            continue  # Do not import unrelated historical closed issues.
        if task and str(task['list']['id']) != LIST:
            raise SyncError('Matched task has a different home List')
        # Preflight every mapping before the first write, including dry runs.
        payload = plan(issue, task, users, open_matches[0], closed_matches[0])
        work.append((issue['number'], task, payload))
    for number, task, payload in work:
        if task and task.get('archived'):
            print(f'Issue #{number}: skipped archived card')
            continue
        action = 'create' if task is None else ('update' if payload else 'unchanged')
        print(f'Issue #{number}: {action}' + (' (dry run)' if dry_run else ''))
        if dry_run or not payload:
            continue
        if task:
            clickup.request('PUT', '/task/' + urllib.parse.quote(task['id'], safe=''), payload)
            task_id = task['id']
        else:
            created = clickup.request('POST', f'/list/{LIST}/task', payload)
            task_id = created.get('id', '')
            if not re.fullmatch(r'[a-zA-Z0-9]+', task_id):
                raise SyncError('Create response lacks a valid task ID; reconcile before retrying')
        verified = clickup.request('GET', '/task/' + urllib.parse.quote(task_id, safe='') + '?include_markdown_description=true')
        if str(verified['list']['id']) != LIST or source_numbers(verified) != {number}:
            raise SyncError(f'Issue #{number}: source identity verification failed; inspect card before rerunning')
        if 'markdown_content' in payload and (verified.get('markdown_description') or '').replace('\r\n', '\n').strip() != payload['markdown_content'].strip():
            raise SyncError(f'Issue #{number}: description verification failed; inspect card before rerunning')
        if ('name' in payload and verified['name'] != payload['name']) or (
                'status' in payload and verified['status']['status'].casefold() != payload['status'].casefold()):
            raise SyncError(f'Issue #{number}: write verification failed')
        expected = set(payload['assignees']) if task is None else (
            {int(u['id']) for u in task['assignees']} | set(payload.get('assignees', {}).get('add', []))
        ) - set(payload.get('assignees', {}).get('rem', []) if task else [])
        if {int(u['id']) for u in verified['assignees']} != expected:
            raise SyncError(f'Issue #{number}: assignee verification failed')
        print(f'Issue #{number}: https://app.clickup.com/t/{task_id}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    try:
        raw = json.loads(os.environ['CLICKUP_ASSIGNEES_JSON'])
        if not isinstance(raw, dict):
            raise SyncError('Assignee map must be a JSON object')
        reconcile(API('github', os.environ['GITHUB_TOKEN']),
                  API('clickup', os.environ['CLICKUP_TOKEN']), raw, args.dry_run)
    except (SyncError, KeyError, ValueError, TypeError):
        # No provider body, issue content, secrets or email addresses in logs.
        error = sys.exc_info()[1]
        print(f'Sync failed: {error if isinstance(error, SyncError) else "invalid configuration or API schema"}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())

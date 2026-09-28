import copy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('sync', Path(__file__).parents[1] / 'clickup_sync.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


def issue(number=17, state='open'):
    return {'number': number, 'state': state, 'title': 'Example', 'body': 'Full body',
            'assignees': [{'login': 'Developer'}]}


def task(status='in progress', kind='custom'):
    return {'id': 'abc', 'name': 'Example', 'assignees': [{'id': 1}],
            'list': {'id': sync.LIST}, 'status': {'status': status, 'type': kind},
            'markdown_description': f'Source: {sync.source_url(17)}\n\nFull body',
            'due_date': 123, 'parent': 'wbs', 'archived': False}


class Fake:
    def __init__(self, cards=None, issue_list=None):
        self.cards = copy.deepcopy([task()] if cards is None else cards)
        self.issues = [issue()] if issue_list is None else issue_list
        self.writes = []

    def request(self, method, path, body=None):
        if method != 'GET':
            self.writes.append((method, path, body))
            if method == 'POST':
                card = dict(task(), id='new123', assignees=[])
                self.cards.append(card)
                card['assignees'] = [{'id': n} for n in body['assignees']]
            else:
                card = next(t for t in self.cards if t['id'] == path.split('/')[-1])
                delta = body.get('assignees', {})
                ids = ({u['id'] for u in card['assignees']} | set(delta.get('add', []))) - set(delta.get('rem', []))
                card['assignees'] = [{'id': n} for n in sorted(ids)]
            for key in ('name', 'markdown_content'):
                if key in body:
                    card['markdown_description' if key == 'markdown_content' else key] = body[key]
            if 'status' in body:
                card['status'] = {'status': body['status'], 'type': 'closed' if body['status'] == 'complete' else 'open'}
            return copy.deepcopy(card)
        if path.startswith('/task/'):
            return copy.deepcopy(next(t for t in self.cards if t['id'] == path.split('/')[-1].split('?')[0]))
        if path == '/team':
            return {'teams': [{'id': sync.WORKSPACE, 'members': [{'user': {'id': 1, 'email': 'synthetic@example.invalid'}}]}]}
        if path == f'/list/{sync.LIST}':
            return {'statuses': [{'status': 'backlog', 'type': 'open'}, {'status': 'complete', 'type': 'closed'}]}
        if '/task?' in path:
            return {'tasks': self.cards if 'archived=false' in path else [], 'last_page': True}
        return self.issues


class SyncTests(unittest.TestCase):
    def test_identity_not_dependency(self):
        card = task()
        card['markdown_description'] = f'GitHub task: {sync.source_url(17)}\nDepends on: {sync.source_url(18)}'
        self.assertEqual(sync.source_numbers(card, legacy=True), {17})
        card['markdown_description'] = f'Source: {sync.source_url(17)}\n\nSource: {sync.source_url(18)}'
        self.assertEqual(sync.source_numbers(card), {17})

    def test_legacy_owner_header_only_for_seed(self):
        card = task()
        card['markdown_description'] = f'Owner: Developer\nGitHub task: {sync.source_url(17)}\nBody'
        self.assertEqual(sync.source_numbers(card), set())
        self.assertEqual(sync.source_numbers(card, legacy=True), {17})
        card['markdown_description'] = f'Some other card\nDepends on: {sync.source_url(17)}'
        self.assertEqual(sync.source_numbers(card, legacy=True), set())

    def test_all_assignees_preflight_before_any_write(self):
        second = issue(18)
        second['assignees'] = [{'login': 'Unmapped'}]
        api = Fake([], [issue(), second])
        with self.assertRaises(sync.SyncError):
            sync.reconcile(api, api, {'developer': 1}, False, {})
        self.assertEqual(api.writes, [])

    def test_tasks_paginate_and_include_archived(self):
        calls = []
        class Pages:
            def request(self, method, path):
                calls.append(path)
                if 'archived=false' in path and 'page=0' in path:
                    return {'tasks': [task()], 'last_page': False}
                if 'archived=true' in path and 'page=0' in path:
                    return {'tasks': [dict(task(), id='archived')], 'last_page': True}
                return {'tasks': [], 'last_page': True}
        self.assertEqual(set(sync.tasks(Pages())), {'abc', 'archived'})
        self.assertEqual(len(calls), 3)
        self.assertTrue(all('include_closed=true' in path for path in calls))

    def test_progress_and_dates_preserved(self):
        self.assertEqual(sync.plan(issue(), task(), {'developer': 1}, 'backlog', 'complete'), {})
        result = sync.plan(issue(state='closed'), task(), {'developer': 1}, 'backlog', 'complete')
        self.assertEqual(result, {'status': 'complete'})

    def test_reopen_and_assignment_delta(self):
        result = sync.plan(issue(), task('complete', 'closed'), {'developer': 2}, 'backlog', 'complete')
        self.assertEqual(result, {'status': 'backlog', 'assignees': {'add': [2], 'rem': [1]}})

    def test_missing_assignee_never_clears(self):
        with self.assertRaises(sync.SyncError):
            sync.plan(issue(), task(), {}, 'backlog', 'complete')

    def test_seed_adoption_and_replay(self):
        api = Fake()
        sync.reconcile(api, api, {'developer': 1}, False, {'17': 'abc'})
        self.assertEqual(api.writes, [])

    def test_legacy_seed_migration_then_noop(self):
        legacy = task()
        legacy['markdown_description'] = f'Owner: Developer\nGitHub task: {sync.source_url(17)}\nOld description'
        api = Fake([legacy])
        sync.reconcile(api, api, {'developer': 1}, False, {'17': 'abc'})
        self.assertEqual(len(api.writes), 1)
        self.assertEqual(api.writes[0][0], 'PUT')
        sync.reconcile(api, api, {'developer': 1}, False, {'17': 'abc'})
        self.assertEqual(len(api.writes), 1)
        self.assertEqual(api.cards[0]['due_date'], 123)
        self.assertEqual(api.cards[0]['parent'], 'wbs')

    def test_close_reopen_title_assignment_roundtrip(self):
        api = Fake(issue_list=[issue(state='closed')])
        sync.reconcile(api, api, {'developer': 1}, False, {'17': 'abc'})
        self.assertEqual(api.cards[0]['status']['status'], 'complete')
        api.issues[0].update(state='open', title='Changed', assignees=[])
        sync.reconcile(api, api, {}, False, {'17': 'abc'})
        self.assertEqual(api.cards[0]['status']['status'], 'backlog')
        self.assertEqual(api.cards[0]['name'], 'Changed')
        self.assertEqual(api.cards[0]['assignees'], [])
        self.assertEqual(api.cards[0]['due_date'], 123)
        self.assertEqual(api.cards[0]['parent'], 'wbs')

    def test_duplicate_refuses_all_writes(self):
        other = dict(task(), id='other')
        api = Fake([task(), other])
        with self.assertRaises(sync.SyncError):
            sync.reconcile(api, api, {'developer': 1}, False, {})
        self.assertEqual(api.writes, [])

    def test_missing_seed_refuses_creation(self):
        api = Fake([])
        with self.assertRaises(sync.SyncError):
            sync.reconcile(api, api, {'developer': 1}, False, {'17': 'abc'})
        self.assertEqual(api.writes, [])

    def test_wrong_list_refuses(self):
        api = Fake([dict(task(), list={'id': 'other'})])
        with self.assertRaises(sync.SyncError):
            sync.reconcile(api, api, {'developer': 1}, False, {})
        self.assertEqual(api.writes, [])

    def test_dry_run_and_historical_closed(self):
        api = Fake([], [issue(), issue(10, 'closed')])
        sync.reconcile(api, api, {'developer': 'synthetic@example.invalid'}, True, {})
        self.assertEqual(api.writes, [])
        sync.reconcile(api, api, {'developer': 1}, False, {})
        self.assertEqual(len(api.writes), 1)
        self.assertEqual(api.writes[0][2]['assignees'], [1])

    def test_archived_card_not_recreated(self):
        api = Fake([dict(task(), archived=True)])
        sync.reconcile(api, api, {'developer': 1}, False, {})
        self.assertEqual(api.writes, [])

    def test_ignored_description_fails_verification(self):
        class IgnoresMarkdown(Fake):
            def request(self, method, path, body=None):
                result = super().request(method, path, body)
                if path.startswith('/task/'):
                    result['markdown_description'] = ''
                return result
        api = IgnoresMarkdown([])
        with self.assertRaisesRegex(sync.SyncError, 'source identity verification failed'):
            sync.reconcile(api, api, {'developer': 1}, False, {})
        self.assertEqual(len(api.writes), 1)

    def test_unknown_create_outcome_not_retried(self):
        api = sync.API('clickup', 'fake-token')
        with patch.object(api.opener, 'open', side_effect=TimeoutError('sensitive')) as send:
            with self.assertRaisesRegex(sync.SyncError, 'unknown'):
                api.request('POST', '/list/1/task', {})
            self.assertEqual(send.call_count, 1)

    def test_read_retry_is_bounded_and_sanitized(self):
        api = sync.API('clickup', 'fake-token')
        with patch.object(api.opener, 'open', side_effect=urllib.error.HTTPError('url', 429, 'secret', {}, None)) as send, patch.object(sync.time, 'sleep'):
            with self.assertRaises(sync.SyncError) as error:
                api.request('GET', '/team')
            self.assertEqual(send.call_count, 3)
            self.assertNotIn('secret', str(error.exception))


if __name__ == '__main__':
    unittest.main()

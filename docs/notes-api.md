# Notes API contract

This is the shared contract for #45-#54. The executable scaffold currently serves
`GET /api/health` and rejects notes requests with `401`. Tests can inject a trusted
session, which reaches `501` until note operations are connected. The payload parsing, conditional writes and CRUD success responses below are the
implementation target for #51, not existing persistence.

## Note representation

```json
{
  "id": "7aacbd8a-8a2e-4f1c-9f17-a734dc884010",
  "title": "Dentist appointment",
  "content": "Today at **21:30**.",
  "createdAt": "2026-10-28T18:00:00Z",
  "updatedAt": "2026-10-28T18:00:00Z"
}
```

| Field | Contract |
| --- | --- |
| `id` | Server-assigned UUID, immutable |
| `title` | String, at most 256 UTF-16 code units; empty is allowed |
| `content` | Markdown string, at most 100,000 UTF-16 code units; empty is allowed |
| `createdAt` | Client-supplied creation instant in UTC ISO 8601, fixed after creation |
| `updatedAt` | Equals `createdAt` initially; set by the server after a successful update |

The client records `createdAt` when it creates the local note draft. Store and
exchange UTC timestamps; format them for the user's locale and time zone only
when displaying them. A client clock can be wrong, so timestamps are not an
ordering, authorization or conflict-control mechanism. Offline synchronization
is not part of this sprint.

Do not trim or normalize the user's title or Markdown. Ownership comes from the
verified server session. Request bodies reject unknown fields, including
`ownerId`, `userId`, `updatedAt` and `revision`.

## Routes

All notes routes require a verified session. JSON requests use
`Content-Type: application/json`.

| Method and path | Request | Success response |
| --- | --- | --- |
| `POST /api/notes` | `{ title, content, createdAt }` | `201`, a Note and its `ETag` |
| `GET /api/notes` | No body | `200`, `{ notes: Note[] }` |
| `GET /api/notes/:id` | UUID path parameter | `200`, a Note and its `ETag` |
| `PUT /api/notes/:id` | `{ title, content }` and `If-Match` | `200`, the saved Note and new `ETag` |
| `DELETE /api/notes/:id` | No body; `If-Match` | `204`, no body |

`PUT` replaces both editable fields. It does not reset `createdAt`. Get the
individual note before editing or deleting it; the list response does not expose
per-note version fields. A missing note and a note owned by someone else both
produce `404` without revealing the owner or stored content.

## Conditional writes

An individual note response carries a strong, opaque `ETag`. The client stores
that value unchanged and sends it as `If-Match` on its next update or deletion.
Atlas accepts one nonempty quoted tag with printable ASCII characters, at most
512 characters including the quotes. Weak tags, tag lists and `*` are not accepted
for writes: the client must identify the exact version it read.
The server must compare it and perform the write atomically within the same
ownership scope. A separate read followed by an unconditional write is not safe.

- Missing `If-Match`: `428 PRECONDITION_REQUIRED`.
- Malformed or unsupported `If-Match`: `400 VALIDATION_ERROR`.
- A valid tag that no longer matches: `412 PRECONDITION_FAILED`.
- Matching tag: apply the change and return the new tag where a Note is returned.

Keep the user's unsaved text after a conflict and let them retrieve the current
note. Automatic merging and saved version history are outside this contract.
The storage implementation owns its internal version mechanism; it is not a
sixth field in the public note JSON.

## Errors

Every API error uses the same safe envelope:

```json
{
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "Sign in to access notes."
  }
}
```

| Status | Meaning |
| --- | --- |
| `400` | Invalid request data or conditional-write header |
| `401` | No valid server session |
| `404` | Route or accessible note not found |
| `412` | The note changed since the client read it |
| `428` | Required conditional-write header is absent |
| `500` | Unexpected server failure, without internal details |
| `501` | Scaffold boundary reached; note operation not connected yet |

Never include SQL errors, provider payloads, credentials, session cookies or the
submitted note content in errors. #47 owns session verification and cookie
security; #46/#51 own persistence, account isolation and atomic conditional writes.

Definitions live in [`shared/notes.ts`](../shared/notes.ts). HTTP semantics follow
[RFC 9110 conditional requests](https://www.rfc-editor.org/rfc/rfc9110.html#section-13)
and [RFC 6585 status 428](https://www.rfc-editor.org/rfc/rfc6585.html#section-3).

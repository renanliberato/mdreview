# mdreview

## What it is

mdreview is a lightweight web app for inline review of Markdown documents.
Comments are stored directly inside the file as an HTML comment block at EOF,
keeping them git-trackable and invisible to standard Markdown renderers.
The app is designed for small teams: run it locally, share the URL over an
HTTP tunnel (ngrok, Tailscale, etc.) for cross-machine collaboration, and
let an LLM (e.g. Claude Code CLI) read and write comments by editing the
file directly — no in-app LLM integration required.

---

## Quickstart

```bash
bun install
cp .env.example .env          # set MDREVIEW_PORT if needed
bun run dev                   # starts server (:3001) + client (:3000) concurrently
open "http://localhost:3000?file=/abs/path/to/your.md&user=YourName"
```

`dev` runs both processes concurrently. The Vite dev server proxies `/api/*`
to the file server so there are no CORS issues.

---

## Environment variables

| Variable        | Default | Description                             |
|-----------------|---------|-----------------------------------------|
| `MDREVIEW_PORT` | `3001`  | Port the file server (Hono) listens on  |

---

## Architecture

```
Browser  http://host:3000?file=/path/to/doc.md&user=alice
   |
   | GET /api/file?path=...
   v
[File Server]  reads file, strips comment block, parses threads
   |
   | { raw, threads, mtime }
   v
[Markdown Renderer]  unified/remark → HTML
  annotates every text leaf with data-offset-start / data-offset-end
   |
   v
[MarkdownView]  renders HTML, wraps anchored text in <mark> tags
  mouseup → captureSelection → { quote, startOffset, endOffset, xpath }
   |
   v
[CommentDialog]  user types comment, submits
   |
   v
[Comment Store]  adds thread to Zustand, calls PATCH /api/file
  server rewrites EOF comment block
   |
   v
[ThreadBubble]  positioned near <mark>; click opens ThreadPanel
   |
   v
[ThreadPanel]  shows thread; reply input; resolve toggle
   |
   v
[Polling]  GET /api/file every 5s; mtime change → setThreads(remote)
```

---

## Comment block format

Comments are appended to the end of the `.md` file as a single HTML comment:

```markdown
# Architecture Decision Record: Cache Strategy

We decided to use Redis for session caching because the latency requirements
are under 5ms and Postgres would saturate under peak load.

## Alternatives Considered

- Memcached: rejected due to lack of native TTL per-key.

<!-- mdreview-comments: {"version":"1","threads":[{"id":"t-abc123","resolved":false,"comments":[{"id":"c-001","threadId":"t-abc123","author":"renan","authorType":"human","createdAt":"2026-04-27T10:00:00Z","text":"Does this still hold after the infra migration?","anchor":{"quote":"Redis for session caching","startOffset":42,"endOffset":66,"xpath":"/html/body/p[1]"}},{"id":"c-002","threadId":"t-abc123","author":"claude-sonnet-4-6","authorType":"llm","createdAt":"2026-04-27T10:05:00Z","text":"Yes — the migration kept Redis. TTL defaults changed from 1h to 30m. Update the ADR.","anchor":{"quote":"Redis for session caching","startOffset":42,"endOffset":66,"xpath":"/html/body/p[1]"}}]}]} -->
```

Schema summary:

| Field                      | Type                  | Notes                              |
|----------------------------|-----------------------|------------------------------------|
| `version`                  | `"1"`                 | Schema version guard               |
| `threads[].id`             | string (uuid v4)      | Stable thread identifier           |
| `threads[].resolved`       | boolean               | False by default                   |
| `threads[].comments[].id`  | string (uuid v4)      | Stable comment identifier          |
| `comments[].author`        | string                | Display name or model name         |
| `comments[].authorType`    | `"human"` \| `"llm"` | Source tag                         |
| `comments[].createdAt`     | ISO 8601 string       | Client-set timestamp               |
| `comments[].text`          | string                | Comment body                       |
| `comments[].anchor.quote`  | string                | Exact selected text (first line)   |
| `comments[].anchor.startOffset` | number           | Char offset in stripped plain text |
| `comments[].anchor.endOffset`   | number           | Char offset after quote            |
| `comments[].anchor.xpath`  | string                | XPath to container element         |

---

## LLM workflow

To have an LLM (e.g. Claude Code) review the document and add comments:

1. Run `claude` (or your CLI of choice) with the Markdown file open.
2. Ask it to review the open threads and respond. The LLM reads and writes
   the comment block directly via file edits — no special integration needed.
3. The web app polls every 5 s and picks up the changes automatically.

Comments authored by an LLM should set `"authorType": "llm"` and use the
model name (e.g. `"claude-sonnet-4-6"`) as `"author"`.

Example prompt:

> Read `/abs/path/to/your.md`. Review the open threads in the
> `<!-- mdreview-comments: ... -->` block and add a reply to each unresolved
> thread. Use `"authorType": "llm"` and `"author": "claude-sonnet-4-6"`.

---

## Sharing a URL

The URL carries all state needed to open a specific file and user:

```
http://host:3000?file=/abs/path/to/your.md&user=alice&thread=t-abc123
```

| Param    | Description                                           |
|----------|-------------------------------------------------------|
| `file`   | Absolute path to the Markdown file on the server host |
| `user`   | Pre-fills the author name (also persisted in localStorage) |
| `thread` | Deep-links directly to a specific thread              |

For cross-machine collaboration, tunnel the file server port with
[ngrok](https://ngrok.com/) or [Tailscale Funnel](https://tailscale.com/kb/1223/funnel/)
and share the resulting URL.

---

## Tests

```bash
bun test
```

Tests use Bun's built-in test runner with happy-dom for DOM APIs.
Coverage areas: comment block parse/serialize/strip, GET/PATCH API routes,
Markdown renderer offset alignment, text selection, re-anchoring (all three
strategies + stress tests for shifted/deleted quotes), Zustand store
optimistic updates and rollback, polling edge cases.

---

## Build for production

```bash
bunx vite build
```

The compiled assets land in `dist/`. For MVP usage, running `bun run dev`
is sufficient. If you want to serve the built assets from the same Hono
server, add a static file middleware pointing at `dist/` to
`src/server/index.ts`.

---

## Limitations / known issues

- **Relaxed path security** — the server accepts any absolute file path; no
  root restriction is enforced. Intended for trusted colleagues only.
- **Last-write-wins** — concurrent edits from multiple users overwrite each
  other; there is no operational transform or conflict resolution.
- **Polling latency** — changes made by other users (or an LLM) appear with
  up to 5 s delay.
- **Cross-element selections** — text selections that span multiple block
  elements are clipped to the first line/node; the rest of the selection is
  silently dropped.

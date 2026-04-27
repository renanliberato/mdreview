# mdreview

## What it is

mdreview is a lightweight web app for inline review of Markdown documents.
Comments are stored directly inside the file as an HTML comment block at EOF,
keeping them git-trackable and invisible to standard Markdown renderers.
The app is designed for small teams: run it locally, share the URL over an
HTTP tunnel (ngrok, Tailscale, etc.) for cross-machine collaboration, and
let an LLM (e.g. Claude Code CLI) read and write comments via the `mdreview`
CLI — no in-app LLM integration required.

---

## Quickstart

```bash
bun install
cp .env.example .env          # set MDREVIEW_PORT if needed
bun run dev                   # starts server (:3001) + client (:3000) concurrently
open "http://localhost:3000?file=your.md&user=YourName"
```

`dev` runs both processes concurrently. The Vite dev server proxies `/api/*`
to the file server so there are no CORS issues.

Files must live inside the `docs/` directory (relative to where you start the
server). Pass paths relative to that root via the `?file=` query parameter.

---

## Environment variables

| Variable               | Default                    | Description                                        |
|------------------------|----------------------------|----------------------------------------------------|
| `MDREVIEW_PORT`        | `3001`                     | Port the file server (Hono) listens on             |
| `MDREVIEW_USERNAME`    | _(unset)_                  | Basic auth username (server + CLI)                 |
| `MDREVIEW_PASSWORD`    | _(unset)_                  | Basic auth password (server + CLI)                 |
| `MDREVIEW_SERVER_URL`  | `http://localhost:3001`    | CLI: backend URL to connect to                     |

Basic auth is only active when both `MDREVIEW_USERNAME` and `MDREVIEW_PASSWORD` are set.

---

## Architecture

```
Browser  http://host:3000?file=doc.md&user=alice
   |
   | GET /api/file?path=...
   v
[File Server]  reads docs/<path>, strips comment block, parses threads
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
[Comment Store]  adds thread to Zustand (optimistic), calls PATCH /api/file
  server rewrites EOF comment block; rolls back on failure
   |
   v
[ThreadBubble]  positioned near <mark>; click opens ThreadPanel
[ThreadSidebar] lists all threads in a sidebar panel
   |
   v
[ThreadPanel]  shows thread; reply input; resolve toggle
   |
   v
[Polling]  GET /api/file every 5s; mtime change → setThreads(remote)

[mdreview CLI]  add-comment, list-threads, list-messages, find-snippet,
  validate, update-comment-ref, upload — connects to server via HTTP
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

## CLI

The `mdreview` CLI talks to a running server and is the recommended interface
for LLM workflows.

```bash
bun src/cli/mdreview.ts <command> [args]
```

| Command              | Usage                                                                 | Description                                     |
|----------------------|-----------------------------------------------------------------------|-------------------------------------------------|
| `list-threads`       | `list-threads <file> [--json]`                                        | List all threads in a file                      |
| `list-messages`      | `list-messages <file> <thread-id> [--json]`                           | Show all comments in a thread                   |
| `add-comment`        | `add-comment <file> <thread-id> --text=<str> [--author=<n>] [--type=human\|llm]` | Append a reply to a thread       |
| `find-snippet`       | `find-snippet <file> <thread-id> [--context=<n>]`                     | Locate a thread's anchor in the file            |
| `validate`           | `validate <file> [--json]`                                            | Check all anchors; report orphaned threads      |
| `update-comment-ref` | `update-comment-ref <file> <thread-id> [--quote] [--start] [--end] [--xpath]` | Update a thread's anchor fields        |
| `upload`             | `upload <local-file.md> [--name=<saved-name.md>]`                     | Upload a local file into the server's docs/     |

The CLI reads `MDREVIEW_SERVER_URL`, `MDREVIEW_USERNAME`, and `MDREVIEW_PASSWORD`
from the environment. Pass `--text=-` to `add-comment` to read comment text from stdin.

---

## LLM workflow

To have an LLM (e.g. Claude Code) review a document and add comments:

1. Start the server (`bun run dev`).
2. Upload the document: `bun src/cli/mdreview.ts upload path/to/doc.md`
3. Ask the LLM to list open threads and reply to each one:

```
List open threads in docs/doc.md with:
  bun src/cli/mdreview.ts list-threads doc.md

For each open thread, read the context with find-snippet, then reply with:
  bun src/cli/mdreview.ts add-comment doc.md <thread-id> \
    --text="<reply>" --author=claude-sonnet-4-6 --type=llm
```

The web app polls every 5 s and picks up changes automatically.

---

## Sharing a URL

The URL carries all state needed to open a specific file and user:

```
http://host:3000?file=doc.md&user=alice&thread=t-abc123
```

| Param    | Description                                                         |
|----------|---------------------------------------------------------------------|
| `file`   | Path to the Markdown file, relative to the server's `docs/` root   |
| `user`   | Pre-fills the author name (also persisted in localStorage)          |
| `thread` | Deep-links directly to a specific thread                            |

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
Markdown renderer offset alignment, text selection, Zustand store optimistic
updates and rollback, polling edge cases, and all CLI commands (add-comment,
find-snippet, list-threads, list-messages, validate, update-comment-ref,
upload — including stdin input, error paths, and offset bridging).

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

- **Path restriction** — the server only serves files inside the `docs/`
  directory (relative to cwd). Requests outside that root are rejected with
  403. Intended for trusted colleagues; there is no per-user access control.
- **Last-write-wins** — concurrent edits from multiple users overwrite each
  other; there is no operational transform or conflict resolution.
- **Polling latency** — changes made by other users (or an LLM) appear with
  up to 5 s delay.
- **Cross-element selections** — text selections that span multiple block
  elements are clipped to the first line/node; the rest of the selection is
  silently dropped.

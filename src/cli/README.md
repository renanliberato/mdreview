# mdreview CLI

mdreview CLI — read, validate, and respond to mdreview comment threads embedded in markdown
files. The CLI is the safe mutation path for the comment block: an LLM (or human) calls these
commands instead of editing the JSON by hand.

The CLI is a thin client over the mdreview backend. All file I/O — reading the markdown,
parsing the comment block, mutating threads — happens server-side. The CLI just sends HTTP
requests, formats the response, and exits with a code that reflects the operation's status.

---

## Configure (server URL + auth)

The CLI reads three environment variables. The same `MDREVIEW_USERNAME` /
`MDREVIEW_PASSWORD` pair must be set on the server too.

| Env var | Default | Purpose |
|---|---|---|
| `MDREVIEW_SERVER_URL` | `http://localhost:3001` | Backend root URL the CLI talks to |
| `MDREVIEW_USERNAME` | (unset) | HTTP basic auth username |
| `MDREVIEW_PASSWORD` | (unset) | HTTP basic auth password |

Auth is enforced on the server only when **both** `MDREVIEW_USERNAME` and `MDREVIEW_PASSWORD`
are set in the server's environment. When set, requests without (or with mismatched) basic
auth are rejected with `401`. The CLI surfaces this as `error: unauthorized` and exits 1.

```bash
# Start the server with auth on
MDREVIEW_USERNAME=admin MDREVIEW_PASSWORD=secret bun run dev:server

# Point the CLI at it
export MDREVIEW_SERVER_URL=http://localhost:3001
export MDREVIEW_USERNAME=admin
export MDREVIEW_PASSWORD=secret
mdreview list-threads my-doc.md
```

> **Path resolution.** The server resolves every `<file>` argument relative to the project's
> `docs/` directory. Pass paths like `architecture.md` or `subdir/spec.md`. Absolute paths and
> `..` traversals are rejected with `forbidden` (exit 2).

---

## Install

### Primary: bun run (no PATH change needed)

```bash
bun install           # deps are already in package.json
bun run cli <command> [args...]
```

### Secondary: symlink onto PATH

```bash
chmod +x bin/mdreview
ln -s "$(pwd)/bin/mdreview" /usr/local/bin/mdreview
```

After that, `mdreview <command> ...` works from any directory.

---

## Commands

### export

```
mdreview export <file> [--output=<local-path>]
```

Downloads a file from the server's `docs/` directory as clean markdown (comment block
stripped). Prints the content to stdout by default; pass `--output=<path>` to write to a
local file instead.

Exit codes: 0 (exported), 1 (bad args / write failed), 2 (file not found / forbidden path).

**Example:**

```
$ mdreview export architecture.md --output=./local-copy.md
exported to /abs/path/local-copy.md

$ mdreview export architecture.md > clean.md
```

---

### upload

```
mdreview upload <local-file.md> [--name=<saved-name.md>]
```

Uploads a local markdown file to the server's `docs/` directory so the other CLI commands can
operate on it. Prints the saved filename (relative to `docs/`) on success. The server
sanitizes the filename to `[a-zA-Z0-9._-]` and enforces a `.md` extension; pass `--name` to
control the on-server filename.

Exit codes: 0 (uploaded), 1 (bad args), 2 (local file not found / forbidden name).

**Example:**

```
$ mdreview upload ./drafts/spec.md --name=spec-v2.md
spec-v2.md
$ mdreview list-threads spec-v2.md
file: /abs/path/docs/spec-v2.md
threads: 0 (open: 0, resolved: 0)
```

---

### validate

```
mdreview validate <file> [--json]
```

Parses the comment block, checks that every thread anchor can be located in the document,
verifies ID uniqueness, and confirms `comment.threadId` matches the parent thread. Prints a
per-thread status line for each thread. Use `--json` to get machine-readable output.

Exit codes: 0 (clean), 4 (any warning or error).

**Example:**

```
$ mdreview validate docs/architecture.md
file: /abs/path/docs/architecture.md
threads: 2 (open: 1, resolved: 1)

[OK] t-abc123  match=exact          line=4   "Redis for session caching"
[OK] t-def456  match=fuzzy          line=12  "TTL defaults"

result: 0 warnings, 0 errors
```

An orphaned thread (quote no longer in doc) prints `[WARN] <id> orphan: quote not found` and
exits 4. Re-anchor it with `update-comment-ref` before replying.

---

### find-snippet

```
mdreview find-snippet <file> <thread-id> [--context=<n>]
```

Prints surrounding source lines for a thread's anchor quote. `--context=3` (default) controls
lines of context above/below. Useful for reading doc context before composing a reply.

Exit codes: 0 (found), 2 (file not found), 3 (thread not found), 4 (anchor orphan).

---

### list-messages

```
mdreview list-messages <file> <thread-id> [--json]
```

Prints all comments in a thread sorted by `createdAt` ascending. Header line shows thread id,
status, and anchor quote. Each comment is numbered `[N]` with author, type, timestamp, and body
(multi-line text preserved, each line indented 4 spaces). `--json` returns the full thread
object with sorted `comments` array.

Exit codes: 0 (OK), 1 (bad args), 2 (file not found), 3 (thread not found).

---

### list-threads

```
mdreview list-threads <file> [--json]
```

Lists all threads sorted by the first comment's `createdAt` ascending. Each row shows thread id,
status, comment count, author/timestamp, a truncated text preview, and the anchor quote.
`--json` returns a `threads` array with `id`, `status`, `commentCount`, `firstComment`, and
`anchor.quote`.

Exit codes: 0 (OK), 1 (bad args), 2 (file not found).

---

### add-comment

```
mdreview add-comment <file> <thread-id> --text=<str> \
    [--author=<name>] [--type=human|llm]
```

Adds a reply comment to the thread. Inherits the thread anchor from `comments[0]`. Writes the
updated comment block back to disk atomically (strip + serialize, byte-equivalent to the server
PATCH). Prints the new comment id on success.

Flags:

| Flag | Default | Description |
|---|---|---|
| `--text=<str>` | (required) | Reply body. Pass `-` to read from stdin |
| `--author=<name>` | `claude` | Author display name |
| `--type=human\|llm` | `llm` | Author type tag |

Exit codes: 0 (written), 1 (bad args), 2 (file not found), 3 (thread not found).

**Example:**

```
$ mdreview add-comment docs/architecture.md t-abc123 \
    --text="Yes — the migration kept Redis. TTL defaults changed to 30m."
c-7f3a2b1e-...
```

Pass `--text=-` to read from stdin: `echo "reply" | mdreview add-comment <file> <id> --text=-`

---

### update-comment-ref

```
mdreview update-comment-ref <file> <thread-id> \
    [--quote=<str>] [--start=<n>] [--end=<n>] [--xpath=<str>]
```

Re-anchors a thread after the underlying prose has changed (see [Anchor drift](#anchor-drift)
below). Updates the anchor for the entire thread: every `comment.anchor` in the thread is
overwritten with the merged result. Missing flags are left unchanged (per-field merge against
`thread.comments[0].anchor`). Prints the persisted anchor as compact JSON.

`--start` and `--end` are **raw-source character offsets** (what you see when reading the
markdown file). The CLI converts them to plain-text offsets before persisting.

Flags:

| Flag | Default | Description |
|---|---|---|
| `--quote=<str>` | (kept) | New anchor quote string |
| `--start=<n>` | (kept) | Raw-source start offset |
| `--end=<n>` | (kept) | Raw-source end offset (recomputed from `--start`+`quote.length` if omitted) |
| `--xpath=<str>` | (kept) | XPath to the container element |

At least one flag is required. Exit codes: 0 (written), 1 (bad args), 2 (file not found),
3 (thread not found).

**Example — quote text changed in doc:**

```
$ mdreview update-comment-ref docs/architecture.md t-abc123 \
    --quote="We adopted Redis for session caching"
{"quote":"We adopted Redis for session caching","startOffset":42,"endOffset":79,"xpath":"/html/body/p[1]"}
```

---

## Exit codes

| Code | Meaning |
|---|---|
| 0 | OK |
| 1 | User error (bad args, malformed flag) |
| 2 | File not found / unreadable |
| 3 | Thread not found |
| 4 | Validation failed / anchor orphan |

---

## Install the Claude Code skill

To let Claude Code automatically use this CLI when reviewing markdown files, install the skill
at user scope:

```bash
mkdir -p ~/.claude/skills/mdreview
cp src/cli/SKILL.md ~/.claude/skills/mdreview/SKILL.md
```

After that, Claude Code will pick up the skill on the next session and follow its workflow when
you ask to review or respond to mdreview threads. The skill content is in this repo at
`src/cli/SKILL.md` (also installed by Step 7 to your home directory).

---

## Future work

- Renderer-based offset index for `find-snippet` (currently uses line-search against stripped
  source).
- Resolve flag for `add-comment` (intentionally omitted; humans resolve via the web UI).
- Concurrency: no precondition checks — last-write-wins, matching the app.

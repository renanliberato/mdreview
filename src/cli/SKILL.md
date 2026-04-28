---
name: mdreview
description: Review and respond to mdreview comment threads (`<!-- mdreview-comments: -->` blocks) in markdown files via the `mdreview` CLI.
allowed-tools: Bash, Read, Grep
---

## When to use

Activate this skill when the user says things like:

- "respond to mdreview comments"
- "review threads in `<file>.md`"
- "address comments in `<file>`"
- "reply to the LLM comments on this ADR"
- "review the open threads in `plans/foo.md`"

Also activate when any markdown file you are reading contains `<!-- mdreview-comments:`.

---

## Backend + auth

The `mdreview` CLI is a thin client; every command talks to the mdreview backend over HTTP.
Three env vars control this:

| Env var | Default | Purpose |
|---|---|---|
| `MDREVIEW_SERVER_URL` | `http://localhost:3001` | Backend root URL |
| `MDREVIEW_USERNAME` | (unset) | HTTP basic auth username |
| `MDREVIEW_PASSWORD` | (unset) | HTTP basic auth password |

If a command fails with `error: unauthorized — check MDREVIEW_USERNAME/MDREVIEW_PASSWORD`, the
server has basic auth on; ask the user for the credentials and re-export them. If a command
fails with `error: cannot reach mdreview server`, ask the user to start the backend
(`bun run dev:server`) or to set `MDREVIEW_SERVER_URL`.

### Persisting credentials between sessions

To avoid asking the user for the URL and credentials every session, cache them in
`~/.config/mdreview/config.json`. **Always check this file first** before running any
mdreview command, and only ask the user for missing values.

**On skill activation (before the first `mdreview ...` call):**

1. Read `~/.config/mdreview/config.json` if it exists. Shape:

   ```json
   {
     "serverUrl": "http://localhost:3001",
     "username": "admin",
     "password": "secret"
   }
   ```

2. Export the values into the current shell so every subsequent `mdreview` call sees them:

   ```bash
   if [ -f ~/.config/mdreview/config.json ]; then
     export MDREVIEW_SERVER_URL=$(jq -r '.serverUrl // empty' ~/.config/mdreview/config.json)
     export MDREVIEW_USERNAME=$(jq -r '.username // empty' ~/.config/mdreview/config.json)
     export MDREVIEW_PASSWORD=$(jq -r '.password // empty' ~/.config/mdreview/config.json)
   fi
   ```

3. If any required value is still missing (or if a command fails with `unauthorized` /
   `cannot reach mdreview server`), ask the user once for the missing piece(s).

**When the user supplies credentials or a URL, persist them immediately:**

```bash
mkdir -p ~/.config/mdreview
# Read existing config (or {}), merge in the new fields, write back.
existing=$(cat ~/.config/mdreview/config.json 2>/dev/null || echo '{}')
echo "$existing" | jq \
  --arg url  "$MDREVIEW_SERVER_URL" \
  --arg user "$MDREVIEW_USERNAME" \
  --arg pass "$MDREVIEW_PASSWORD" \
  '. + (
     (if $url  != "" then {serverUrl: $url}  else {} end) +
     (if $user != "" then {username:  $user} else {} end) +
     (if $pass != "" then {password:  $pass} else {} end)
   )' > ~/.config/mdreview/config.json
chmod 600 ~/.config/mdreview/config.json
```

Tell the user briefly that the value has been saved to
`~/.config/mdreview/config.json` (mode `600`) so the next session won't ask again. Never
echo the password back. If the user asks to forget the credentials, delete the file with
`rm ~/.config/mdreview/config.json`.

`<file>` paths in every command below are interpreted **relative to the server's `docs/`
directory** — absolute paths and `..` traversals are rejected as `forbidden` (exit 2). To
review a file that lives outside `docs/`, use `mdreview upload` first (see step 0).

---

## Workflow

Rule: never hand-edit the JSON in the comment block. Always shell out to `mdreview`.

0. **(If the file is not yet under `docs/`) upload it first.**

   ```
   mdreview upload <local-file.md> [--name=<saved-name.md>]
   ```

   Prints the saved filename (relative to `docs/`); use that name for every subsequent
   command in this session.

1. **List threads.**

   ```
   mdreview list-threads <file>
   ```

   This prints each thread id, status, first comment author/timestamp, and anchor quote, sorted
   by `createdAt`. Then optionally run `mdreview validate <file>` if you suspect format issues.

2. **Read full thread context.**

   ```
   mdreview list-messages <file> <thread-id>
   ```

   This prints all prior comments in the thread, sorted chronologically. Read it before
   composing a reply so you have full context.

3. **Read surrounding doc context.**

   ```
   mdreview find-snippet <file> <thread-id> --context=5
   ```

   This prints the surrounding source lines with a `> ` marker on the match line. If you need
   more surrounding content, use the Read tool on the same file with explicit line ranges.

4. **Decide on a reply.** If the concern is out of scope or requires human judgment, say so
   — the human can resolve the thread via the web UI.

5. **Add your reply.**

   ```
   mdreview add-comment <file> <thread-id> --text="..."
   ```

   Defaults: `--author=claude --type=llm`. The CLI prints the new comment id on success; that
   is the signal that the write succeeded.

6. **Confirm.** Re-run `mdreview validate <file>`. Thread count should be unchanged and there
   should be no new errors.

---

## Queue-driven loop (responding to @ai mentions)

When you need to process all outstanding `@ai` mentions in a file without listing threads
first, use the queue command:

```
mdreview next-ai-mention <file> --json
```

This returns the oldest unresolved thread whose last comment starts with `@ai` (word
boundary, case-sensitive), along with the surrounding source snippet. When no such thread
remains, the command exits with code **5** — use that as the loop-stop signal:

```bash
while true; do
  result=$(mdreview next-ai-mention <file> --json)
  code=$?
  [ $code -eq 5 ] && break          # no more @ai mentions
  [ $code -ne 0 ] && { echo "error"; break; }
  thread_id=$(echo "$result" | jq -r '.thread.id')
  # … compose and post reply …
  mdreview add-comment <file> "$thread_id" --text="..."
done
```

The JSON shape is:
```json
{
  "thread": { /* full Thread object */ },
  "snippet": {
    "quote": "...",
    "line": 3,
    "col": 5,
    "strategy": "fuzzy",
    "contextBlock": "..."
  }
}
```

When the thread's anchor no longer resolves (the stored quote is not found in the document),
`snippet` is `null`:

```json
{
  "thread": { /* full Thread object */ },
  "snippet": null
}
```

**Orphan branch:** When `snippet` is `null`, the anchor is orphaned — the human has edited
the document and the stored quote no longer exists. Do **not** attempt prose-based reasoning
about the document context. Instead:

1. Add a comment to the thread explaining that the anchor is orphaned and asking the human
   to re-anchor it before you can continue:
   ```
   mdreview add-comment <file> <thread-id> \
     --text="The anchor for this thread is orphaned — the quoted text no longer appears in the document. Please re-anchor the thread with a current quote using \`mdreview update-comment-ref\`, then mention @ai again."
   ```
2. Re-run `mdreview next-ai-mention <file> --json` to continue draining the queue.

---

## Anchor drift

When `validate` reports `[WARN] orphan` or `find-snippet` returns exit 4, the stored quote no
longer appears in the document (e.g., the human edited the prose). Re-anchor the thread before
replying:

```
mdreview update-comment-ref <file> <thread-id> --quote="<new substring>"
```

You can omit `--start` if you only need to update the quote string. If you also know the
raw-source offset where the new text begins, pass `--start=<offset>` to improve anchor
precision.

**Example:** The doc now reads "We adopted Redis for session caching" but the stored quote was
"We use Redis for session caching":

```
mdreview update-comment-ref docs/foo.md t-abc123 \
    --quote="We adopted Redis for session caching"
```

The command prints the persisted anchor as compact JSON so you can confirm the new offsets.

---

## CLI discovery and exit codes

If `mdreview` is not on PATH, fall back to:

```
bun run --cwd <project-root> cli <command> [args...]
```

Exit codes:

| Code | Meaning |
|---|---|
| 0 | OK |
| 1 | User error (bad args, malformed flag) |
| 2 | File not found / unreadable |
| 3 | Thread not found |
| 4 | Validation failed / anchor orphan |
| 5 | No pending @ai mentions |

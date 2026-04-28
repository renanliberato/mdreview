import { Hono } from 'hono';
import { readFile, writeFile } from 'fs/promises';
import { resolve, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  parseCommentBlock,
  stripCommentBlock,
  serializeCommentBlock,
} from '../../shared/commentBlock';
import type { Comment, SelectionAnchor, Thread } from '../../shared/types';
import {
  exactNear,
  firstHit,
  tokenPrefix,
  lineOf,
  formatContext,
} from '../../cli/lib/lineIndex';
import { sourceToPlainText } from '../../cli/lib/offsetBridge';
import { selectNextAiMention } from '../lib/nextAiMention';

const cli = new Hono();

function docsRoot(): string {
  return resolve(process.env.MDREVIEW_DOCS_ROOT ?? join(process.cwd(), 'docs'));
}

function resolveSafePath(inputPath: string): string | null {
  const root = docsRoot();
  const resolved = resolve(root, inputPath);
  if (!resolved.startsWith(root + '/') && resolved !== root) return null;
  return resolved;
}

async function loadFile(filePath: string): Promise<
  | { ok: true; absPath: string; raw: string }
  | { ok: false; status: number; body: { error: string } }
> {
  const absPath = resolveSafePath(filePath);
  if (!absPath) return { ok: false, status: 403, body: { error: 'forbidden' } };

  try {
    const raw = await readFile(absPath, 'utf-8');
    return { ok: true, absPath, raw };
  } catch (err: unknown) {
    const isNotFound =
      err instanceof Error &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT';
    if (isNotFound) return { ok: false, status: 404, body: { error: 'not_found' } };
    return { ok: false, status: 500, body: { error: 'read_failed' } };
  }
}

// ---------------------------------------------------------------------------
// POST /api/cli/upload  body: { name: string, content: string }
// Saves to docs/<sanitized-name>.md and returns { path }.
// ---------------------------------------------------------------------------
cli.post('/upload', async (c) => {
  let body: { name?: string; content?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_body' }, 400);
  }

  const { name, content } = body;
  if (!name || typeof name !== 'string') {
    return c.json({ error: 'missing_name' }, 400);
  }
  if (typeof content !== 'string') {
    return c.json({ error: 'missing_content' }, 400);
  }

  const sanitized = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!sanitized.endsWith('.md')) {
    return c.json({ error: 'not_markdown' }, 400);
  }

  const absPath = resolveSafePath(sanitized);
  if (!absPath) return c.json({ error: 'forbidden' }, 403);

  try {
    await writeFile(absPath, content, 'utf-8');
    return c.json({ path: sanitized });
  } catch {
    return c.json({ error: 'write_failed' }, 500);
  }
});

// ---------------------------------------------------------------------------
// GET /api/cli/threads?path=
// ---------------------------------------------------------------------------
cli.get('/threads', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) return c.json({ error: 'missing_path' }, 400);

  const loaded = await loadFile(filePath);
  if (!loaded.ok) return c.json(loaded.body, loaded.status as 400 | 403 | 404 | 500);

  const threads = parseCommentBlock(loaded.raw);
  return c.json({ file: loaded.absPath, threads });
});

// ---------------------------------------------------------------------------
// GET /api/cli/messages?path=&threadId=
// ---------------------------------------------------------------------------
cli.get('/messages', async (c) => {
  const filePath = c.req.query('path');
  const threadId = c.req.query('threadId');
  if (!filePath) return c.json({ error: 'missing_path' }, 400);
  if (!threadId) return c.json({ error: 'missing_thread_id' }, 400);

  const loaded = await loadFile(filePath);
  if (!loaded.ok) return c.json(loaded.body, loaded.status as 400 | 403 | 404 | 500);

  const threads = parseCommentBlock(loaded.raw);
  const thread = threads.find((t) => t.id === threadId);
  if (!thread) return c.json({ error: 'thread_not_found', threadId }, 404);

  return c.json({ file: loaded.absPath, thread });
});

// ---------------------------------------------------------------------------
// POST /api/cli/comments  body: { path, threadId, text, author?, authorType? }
// ---------------------------------------------------------------------------
cli.post('/comments', async (c) => {
  let body: {
    path?: string;
    threadId?: string;
    text?: string;
    author?: string;
    authorType?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_body' }, 400);
  }

  const { path: filePath, threadId, text, author, authorType } = body;
  if (!filePath) return c.json({ error: 'missing_path' }, 400);
  if (!threadId) return c.json({ error: 'missing_thread_id' }, 400);
  if (typeof text !== 'string' || text === '') {
    return c.json({ error: 'invalid_text' }, 400);
  }
  const at = authorType ?? 'llm';
  if (at !== 'human' && at !== 'llm') {
    return c.json({ error: 'invalid_author_type' }, 400);
  }

  const loaded = await loadFile(filePath);
  if (!loaded.ok) return c.json(loaded.body, loaded.status as 400 | 403 | 404 | 500);

  const threads = parseCommentBlock(loaded.raw);
  const thread = threads.find((t) => t.id === threadId);
  if (!thread) return c.json({ error: 'thread_not_found', threadId }, 404);

  const newComment: Comment = {
    id: 'c-' + uuidv4(),
    threadId: thread.id,
    author: author ?? 'claude',
    authorType: at,
    createdAt: new Date().toISOString(),
    text,
    anchor: { ...thread.comments[0].anchor },
  };
  thread.comments.push(newComment);

  try {
    await writeFile(
      loaded.absPath,
      stripCommentBlock(loaded.raw) + serializeCommentBlock(threads),
      'utf-8',
    );
  } catch {
    return c.json({ error: 'write_failed' }, 500);
  }

  return c.json({ id: newComment.id, comment: newComment });
});

// ---------------------------------------------------------------------------
// PATCH /api/cli/anchor  body: { path, threadId, quote?, start?, end?, xpath? }
// ---------------------------------------------------------------------------
cli.patch('/anchor', async (c) => {
  let body: {
    path?: string;
    threadId?: string;
    quote?: string;
    start?: number;
    end?: number;
    xpath?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_body' }, 400);
  }

  const { path: filePath, threadId, quote, start, end, xpath } = body;
  if (!filePath) return c.json({ error: 'missing_path' }, 400);
  if (!threadId) return c.json({ error: 'missing_thread_id' }, 400);

  const hasQuote = quote !== undefined;
  const hasStart = start !== undefined;
  const hasEnd = end !== undefined;
  const hasXpath = xpath !== undefined;
  if (!hasQuote && !hasStart && !hasEnd && !hasXpath) {
    return c.json({ error: 'no_fields' }, 400);
  }

  if (hasStart && (!Number.isInteger(start) || (start as number) < 0)) {
    return c.json({ error: 'invalid_start' }, 400);
  }
  if (hasEnd && (!Number.isInteger(end) || (end as number) < 0)) {
    return c.json({ error: 'invalid_end' }, 400);
  }
  if (hasStart && hasEnd && (end as number) < (start as number)) {
    return c.json({ error: 'end_before_start' }, 400);
  }

  const loaded = await loadFile(filePath);
  if (!loaded.ok) return c.json(loaded.body, loaded.status as 400 | 403 | 404 | 500);

  const threads = parseCommentBlock(loaded.raw);
  const thread = threads.find((t) => t.id === threadId);
  if (!thread) return c.json({ error: 'thread_not_found', threadId }, 404);

  const rawStripped = stripCommentBlock(loaded.raw);
  if (hasStart && (start as number) > rawStripped.length) {
    return c.json({ error: 'start_out_of_bounds' }, 400);
  }
  if (hasEnd && (end as number) > rawStripped.length) {
    return c.json({ error: 'end_out_of_bounds' }, 400);
  }

  let plainStart: number | null = null;
  let plainEnd: number | null = null;
  if (hasStart) plainStart = sourceToPlainText(rawStripped, start as number);

  let resolvedSourceEnd = hasEnd ? (end as number) : null;
  if (resolvedSourceEnd === null && hasQuote && hasStart) {
    resolvedSourceEnd = (start as number) + (quote as string).length;
  }
  if (resolvedSourceEnd !== null) {
    plainEnd = sourceToPlainText(rawStripped, resolvedSourceEnd);
  }

  const base: SelectionAnchor = thread.comments[0].anchor;
  const merged: SelectionAnchor = {
    quote: hasQuote ? (quote as string) : base.quote,
    startOffset: plainStart !== null ? plainStart : base.startOffset,
    endOffset:
      plainEnd !== null
        ? plainEnd
        : hasQuote && plainStart !== null
          ? plainStart + (quote as string).length
          : base.endOffset,
    xpath: hasXpath ? (xpath as string) : base.xpath,
  };

  for (const cm of thread.comments) cm.anchor = { ...merged };

  try {
    await writeFile(
      loaded.absPath,
      stripCommentBlock(loaded.raw) + serializeCommentBlock(threads),
      'utf-8',
    );
  } catch {
    return c.json({ error: 'write_failed' }, 500);
  }

  return c.json({ anchor: merged });
});

// ---------------------------------------------------------------------------
// GET /api/cli/find-snippet?path=&threadId=&context=N
// ---------------------------------------------------------------------------
cli.get('/find-snippet', async (c) => {
  const filePath = c.req.query('path');
  const threadId = c.req.query('threadId');
  const ctxRaw = c.req.query('context') ?? '3';
  if (!filePath) return c.json({ error: 'missing_path' }, 400);
  if (!threadId) return c.json({ error: 'missing_thread_id' }, 400);

  const ctxN = parseInt(ctxRaw, 10);
  if (Number.isNaN(ctxN) || ctxN < 0) {
    return c.json({ error: 'invalid_context' }, 400);
  }

  const loaded = await loadFile(filePath);
  if (!loaded.ok) return c.json(loaded.body, loaded.status as 400 | 403 | 404 | 500);

  const rawStripped = stripCommentBlock(loaded.raw);
  const threads = parseCommentBlock(loaded.raw);
  const thread = threads.find((t) => t.id === threadId);
  if (!thread) return c.json({ error: 'thread_not_found', threadId }, 404);

  const anchor = thread.comments[0]?.anchor;
  if (!anchor) return c.json({ error: 'orphan' }, 422);

  const result = firstHit(rawStripped, anchor) ?? tokenPrefix(rawStripped, anchor);
  if (!result) return c.json({ error: 'orphan' }, 422);

  const { line, col } = lineOf(rawStripped, result.offset);
  const lines = rawStripped.split('\n');
  const contextBlock = formatContext(lines, line, ctxN);

  return c.json({
    threadId: thread.id,
    quote: anchor.quote,
    line,
    col,
    strategy: result.strategy,
    contextBlock,
  });
});

// ---------------------------------------------------------------------------
// GET /api/cli/next-ai-mention?path=&context=N
// ---------------------------------------------------------------------------
cli.get('/next-ai-mention', async (c) => {
  const filePath = c.req.query('path');
  const ctxRaw = c.req.query('context') ?? '3';
  if (!filePath) return c.json({ error: 'missing_path' }, 400);

  const ctxN = parseInt(ctxRaw, 10);
  if (Number.isNaN(ctxN) || ctxN < 0) {
    return c.json({ error: 'invalid_context' }, 400);
  }

  const loaded = await loadFile(filePath);
  if (!loaded.ok) return c.json(loaded.body, loaded.status as 400 | 403 | 404 | 500);

  const rawStripped = stripCommentBlock(loaded.raw);
  const threads = parseCommentBlock(loaded.raw);

  const thread = selectNextAiMention(threads);
  if (!thread) return c.json({ error: 'no_pending_ai_mention' }, 404);

  const anchor = thread.comments[0]?.anchor;
  if (!anchor) return c.json({ error: 'orphan' }, 422);

  const result = firstHit(rawStripped, anchor) ?? tokenPrefix(rawStripped, anchor);
  if (!result) return c.json({ error: 'orphan' }, 422);

  const { line, col } = lineOf(rawStripped, result.offset);
  const lines = rawStripped.split('\n');
  const contextBlock = formatContext(lines, line, ctxN);

  return c.json({
    thread,
    snippet: {
      quote: anchor.quote,
      line,
      col,
      strategy: result.strategy,
      contextBlock,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/cli/validate?path=
// ---------------------------------------------------------------------------
interface ValidateThreadResult {
  id: string;
  resolved: boolean;
  strategy: 'exact' | 'fuzzy' | 'line-search' | null;
  line: number | null;
  quote: string;
  issues: string[];
}

function classifyThread(
  rawStripped: string,
  thread: Thread,
): { strategy: 'exact' | 'fuzzy' | 'line-search' | null; line: number | null } {
  const anchor = thread.comments[0]?.anchor;
  if (!anchor) return { strategy: null, line: null };
  const hit =
    exactNear(rawStripped, anchor) ??
    firstHit(rawStripped, anchor) ??
    tokenPrefix(rawStripped, anchor);
  if (!hit) return { strategy: null, line: null };
  const { line } = lineOf(rawStripped, hit.offset);
  return { strategy: hit.strategy, line };
}

cli.get('/validate', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) return c.json({ error: 'missing_path' }, 400);

  const loaded = await loadFile(filePath);
  if (!loaded.ok) return c.json(loaded.body, loaded.status as 400 | 403 | 404 | 500);

  const rawStripped = stripCommentBlock(loaded.raw);
  const threads = parseCommentBlock(loaded.raw);

  const errors: string[] = [];
  const warnings: string[] = [];
  const threadResults: ValidateThreadResult[] = [];

  const jsonBlockMatch = loaded.raw.match(/<!-- mdreview-comments:\s*(\{[\s\S]*?\})\s*-->/);
  if (jsonBlockMatch) {
    try {
      JSON.parse(jsonBlockMatch[1]);
    } catch {
      errors.push('malformed comment block JSON');
    }
  }

  const allIds: string[] = [];
  for (const t of threads) {
    allIds.push(t.id);
    for (const cm of t.comments) allIds.push(cm.id);
  }
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const id of allIds) {
    if (seen.has(id)) dups.add(id);
    else seen.add(id);
  }
  for (const id of dups) errors.push(`duplicate id: ${id}`);

  for (const thread of threads) {
    const quote = thread.comments[0]?.anchor?.quote ?? '';
    const { strategy, line } = classifyThread(rawStripped, thread);
    const issues: string[] = [];
    if (strategy === null) {
      warnings.push(`orphan: ${thread.id}`);
      issues.push('orphan');
    }
    for (const comment of thread.comments) {
      if (comment.threadId !== thread.id) {
        errors.push(
          `comment ${comment.id} has threadId ${comment.threadId} but lives in thread ${thread.id}`,
        );
        issues.push('threadId mismatch');
      }
    }
    threadResults.push({
      id: thread.id,
      resolved: thread.resolved,
      strategy,
      line,
      quote,
      issues,
    });
  }

  return c.json({
    file: loaded.absPath,
    openCount: threads.filter((t) => !t.resolved).length,
    resolvedCount: threads.filter((t) => t.resolved).length,
    threads: threadResults,
    errors,
    warnings,
  });
});

export default cli;

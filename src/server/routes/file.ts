import { Hono } from 'hono';
import { readFile, writeFile, stat } from 'fs/promises';
import { resolve, join } from 'path';
import { parseCommentBlock, stripCommentBlock, serializeCommentBlock } from '../../shared/commentBlock';
import type { Thread } from '../../shared/types';

const file = new Hono();

function docsRoot(): string {
  return resolve(process.env.MDREVIEW_DOCS_ROOT ?? join(process.cwd(), 'docs'));
}

function resolveSafePath(inputPath: string): string | null {
  const root = docsRoot();
  const resolved = resolve(root, inputPath);
  if (!resolved.startsWith(root + '/') && resolved !== root) return null;
  return resolved;
}

/**
 * GET /api/file?path=
 * path is relative to the docs/ directory.
 * Returns { raw, threads, mtime }
 */
file.get('/', async (c) => {
  const filePath = c.req.query('path');
  if (!filePath) {
    return c.json({ error: 'missing_path' }, 400);
  }

  const absPath = resolveSafePath(filePath);
  if (!absPath) {
    return c.json({ error: 'forbidden' }, 403);
  }

  try {
    const [content, fileStat] = await Promise.all([
      readFile(absPath, 'utf-8'),
      stat(absPath),
    ]);

    const threads = parseCommentBlock(content);
    const raw = stripCommentBlock(content);

    return c.json({ raw, threads, mtime: fileStat.mtimeMs });
  } catch (err: unknown) {
    const isNotFound =
      err instanceof Error &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT';

    if (isNotFound) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json({ error: 'read_failed' }, 500);
  }
});

/**
 * PATCH /api/file
 * Body: { path: string, threads: Thread[] }
 * path is relative to the docs/ directory.
 */
file.patch('/', async (c) => {
  let body: { path: string; threads: Thread[] };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_body' }, 400);
  }

  const { path: filePath, threads } = body;
  if (!filePath) {
    return c.json({ error: 'missing_path' }, 400);
  }

  const absPath = resolveSafePath(filePath);
  if (!absPath) {
    return c.json({ error: 'forbidden' }, 403);
  }

  try {
    let content = '';
    try {
      content = await readFile(absPath, 'utf-8');
    } catch (err: unknown) {
      const isNotFound =
        err instanceof Error &&
        'code' in err &&
        (err as NodeJS.ErrnoException).code === 'ENOENT';
      if (isNotFound) {
        return c.json({ error: 'not_found' }, 404);
      }
      throw err;
    }

    const stripped = stripCommentBlock(content);
    const newContent = stripped + serializeCommentBlock(threads);
    await writeFile(absPath, newContent, 'utf-8');

    return c.json({ ok: true });
  } catch {
    return c.json({ error: 'write_failed' }, 500);
  }
});

/**
 * POST /api/file/upload
 * Accepts multipart/form-data with a single "file" field (markdown file).
 * Saves to docs/<filename> and returns { path: string }.
 */
file.post('/upload', async (c) => {
  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch {
    return c.json({ error: 'invalid_body' }, 400);
  }

  const uploadedFile = formData.get('file');
  if (!(uploadedFile instanceof File)) {
    return c.json({ error: 'missing_file' }, 400);
  }

  const name = uploadedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!name.endsWith('.md')) {
    return c.json({ error: 'not_markdown' }, 400);
  }

  const absPath = resolveSafePath(name);
  if (!absPath) {
    return c.json({ error: 'forbidden' }, 403);
  }

  try {
    const text = await uploadedFile.text();
    await writeFile(absPath, text, 'utf-8');
    return c.json({ path: name });
  } catch {
    return c.json({ error: 'write_failed' }, 500);
  }
});

export default file;

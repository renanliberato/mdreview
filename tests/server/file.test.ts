import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test';
import { writeFile, unlink, mkdtemp } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Server } from 'http';
import fileRoute from '../../src/server/routes/file';
import type { Thread } from '../../src/shared/types';

// ---- app setup ----------------------------------------------------------------

const TEST_PORT = 3997;

let server: Server;
let baseUrl: string;

const app = new Hono();
app.route('/api/file', fileRoute);

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: TEST_PORT }, () => {
      baseUrl = `http://localhost:${TEST_PORT}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

// ---- helpers ------------------------------------------------------------------

async function tmpFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mdreview-test-'));
  const filePath = join(dir, 'test.md');
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

async function cleanupFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    // ignore if already gone
  }
}

const sampleThread: Thread = {
  id: 't-001',
  resolved: false,
  comments: [
    {
      id: 'c-001',
      threadId: 't-001',
      author: 'renan',
      authorType: 'human',
      createdAt: '2026-04-27T10:00:00Z',
      text: 'Is this correct?',
      anchor: {
        quote: 'hello',
        startOffset: 0,
        endOffset: 5,
        xpath: '/html/body/p[1]',
      },
    },
  ],
};

// ---- tests --------------------------------------------------------------------

describe('GET /api/file', () => {
  it('returns raw content, empty threads, and mtime > 0 for existing file', async () => {
    const filePath = await tmpFile('# Hello\n\nSome content.\n');
    try {
      const res = await fetch(`${baseUrl}/api/file?path=${encodeURIComponent(filePath)}`);
      expect(res.status).toBe(200);

      const body = await res.json() as { raw: string; threads: Thread[]; mtime: number };
      expect(body.raw).toContain('# Hello');
      expect(body.threads).toEqual([]);
      expect(body.mtime).toBeGreaterThan(0);
    } finally {
      await cleanupFile(filePath);
    }
  });

  it('returns 404 for a non-existent file', async () => {
    const res = await fetch(`${baseUrl}/api/file?path=${encodeURIComponent('/tmp/this-does-not-exist-mdreview.md')}`);
    expect(res.status).toBe(404);

    const body = await res.json() as { error: string };
    expect(body.error).toBe('not_found');
  });

  it('strips the comment block from raw before returning it', async () => {
    const content = '# Doc\n\nBody text.\n\n<!-- mdreview-comments: {"version":"1","threads":[]} -->\n';
    const filePath = await tmpFile(content);
    try {
      const res = await fetch(`${baseUrl}/api/file?path=${encodeURIComponent(filePath)}`);
      const body = await res.json() as { raw: string; threads: Thread[] };
      expect(body.raw).not.toContain('<!-- mdreview-comments:');
      expect(body.threads).toEqual([]);
    } finally {
      await cleanupFile(filePath);
    }
  });
});

describe('PATCH /api/file', () => {
  it('creates a comment block at EOF when the file has none', async () => {
    const filePath = await tmpFile('# Hello\n\nSome content.\n');
    try {
      const res = await fetch(`${baseUrl}/api/file`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, threads: [sampleThread] }),
      });
      expect(res.status).toBe(200);

      const body = await res.json() as { ok: boolean };
      expect(body.ok).toBe(true);

      // Verify content via GET
      const getRes = await fetch(`${baseUrl}/api/file?path=${encodeURIComponent(filePath)}`);
      const getBody = await getRes.json() as { threads: Thread[] };
      expect(getBody.threads).toHaveLength(1);
      expect(getBody.threads[0].id).toBe('t-001');
    } finally {
      await cleanupFile(filePath);
    }
  });

  it('replaces an existing comment block rather than doubling it', async () => {
    const existingBlock = '# Doc\n\nContent.\n\n<!-- mdreview-comments: {"version":"1","threads":[{"id":"old-thread","resolved":true,"comments":[]}]} -->\n';
    const filePath = await tmpFile(existingBlock);
    try {
      const newThread: Thread = {
        id: 'new-thread',
        resolved: false,
        comments: [],
      };

      const res = await fetch(`${baseUrl}/api/file`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, threads: [newThread] }),
      });
      expect(res.status).toBe(200);

      // Verify only one block present and it has the new thread
      const getRes = await fetch(`${baseUrl}/api/file?path=${encodeURIComponent(filePath)}`);
      const getBody = await getRes.json() as { raw: string; threads: Thread[] };

      expect(getBody.threads).toHaveLength(1);
      expect(getBody.threads[0].id).toBe('new-thread');
      // Old thread should be gone
      expect(getBody.threads.find((t) => t.id === 'old-thread')).toBeUndefined();

      // Verify no duplicate comment blocks in raw
      const occurrences = (getBody.raw + '').split('mdreview-comments').length - 1;
      expect(occurrences).toBe(0); // raw has the block stripped
    } finally {
      await cleanupFile(filePath);
    }
  });
});

describe('GET after PATCH', () => {
  it('returns the patched threads on subsequent GET', async () => {
    const filePath = await tmpFile('# Doc\n\nText here.\n');
    try {
      // PATCH with a thread
      await fetch(`${baseUrl}/api/file`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath, threads: [sampleThread] }),
      });

      // GET should return the thread
      const res = await fetch(`${baseUrl}/api/file?path=${encodeURIComponent(filePath)}`);
      expect(res.status).toBe(200);

      const body = await res.json() as { raw: string; threads: Thread[]; mtime: number };
      expect(body.threads).toHaveLength(1);
      expect(body.threads[0].id).toBe('t-001');
      expect(body.threads[0].comments[0].text).toBe('Is this correct?');
      expect(body.mtime).toBeGreaterThan(0);
      // raw should NOT contain the comment block
      expect(body.raw).not.toContain('<!-- mdreview-comments:');
    } finally {
      await cleanupFile(filePath);
    }
  });
});

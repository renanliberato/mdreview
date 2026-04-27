import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { spawn } from 'bun';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

// ---------------------------------------------------------------------------
// CLI runner helper
// ---------------------------------------------------------------------------

async function runCli(
  args: string[],
  cwd?: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const proc = spawn({
    cmd: ['bun', 'run', join(import.meta.dir, '../../src/cli/mdreview.ts'), ...args],
    cwd: cwd ?? process.cwd(),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const code = await proc.exited;
  return {
    stdout: await new Response(proc.stdout).text(),
    stderr: await new Response(proc.stderr).text(),
    code,
  };
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'mdreview-list-messages-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

function commentBlock(threads: object[]): string {
  const payload = { version: '1', threads };
  return `\n\n<!-- mdreview-comments: ${JSON.stringify(payload)} -->\n`;
}

function makeThread(opts: {
  threadId?: string;
  comments?: object[];
  resolved?: boolean;
  quote?: string;
  startOffset?: number;
}): object {
  const threadId = opts.threadId ?? 't-redis';
  const resolved = opts.resolved ?? false;
  const quote = opts.quote ?? 'Redis for session caching';
  const startOffset = opts.startOffset ?? 30;
  const anchor = {
    quote,
    startOffset,
    endOffset: startOffset + quote.length,
    xpath: '/html/body/p',
  };
  const comments = opts.comments ?? [
    {
      id: 'c-redis-1',
      threadId,
      author: 'renan',
      authorType: 'human',
      createdAt: '2026-04-27T10:00:00Z',
      text: 'Does this still hold post-migration?',
      anchor,
    },
  ];
  return { id: threadId, resolved, comments };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('list-messages command', () => {
  it('missing positional args → exit 1 with usage in stderr', async () => {
    const { stderr, code } = await runCli(['list-messages']);
    expect(code).toBe(1);
    expect(stderr).toContain('usage');
    expect(stderr).toContain('list-messages');
  });

  it('missing thread-id arg → exit 1', async () => {
    const { stderr, code } = await runCli(['list-messages', 'some-file.md']);
    expect(code).toBe(1);
    expect(stderr).toContain('usage');
  });

  it('file not found → exit 2', async () => {
    const { stderr, code } = await runCli(['list-messages', '/nonexistent/doc.md', 't-redis']);
    expect(code).toBe(2);
    expect(stderr).toContain('not_found');
  });

  it('unknown thread id → exit 3 with error in stderr', async () => {
    const body = '# Cache\n\nRedis for session caching.\n';
    const thread = makeThread({});
    const mdPath = join(tmpDir, 'known.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stderr, code } = await runCli(['list-messages', mdPath, 't-nonexistent']);
    expect(code).toBe(3);
    expect(stderr).toContain('thread t-nonexistent not found');
  });

  it('happy path: 2 comments, header line, file line, --, two [N] blocks', async () => {
    const body = '# Cache\n\nRedis for session caching.\n';
    const anchor = {
      quote: 'Redis for session caching',
      startOffset: 9,
      endOffset: 34,
      xpath: '/html/body/p',
    };
    const thread = {
      id: 't-redis',
      resolved: false,
      comments: [
        {
          id: 'c-redis-1',
          threadId: 't-redis',
          author: 'renan',
          authorType: 'human',
          createdAt: '2026-04-27T10:00:00Z',
          text: 'Does this still hold post-migration?',
          anchor,
        },
        {
          id: 'c-redis-2',
          threadId: 't-redis',
          author: 'claude',
          authorType: 'llm',
          createdAt: '2026-04-27T11:05:00Z',
          text: 'Redis kept post-migration, TTL defaults changed.',
          anchor,
        },
      ],
    };
    const mdPath = join(tmpDir, 'happy.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli(['list-messages', mdPath, 't-redis']);
    expect(code).toBe(0);
    expect(stdout).toContain('thread: t-redis (open)');
    expect(stdout).toContain('anchor: "Redis for session caching"');
    expect(stdout).toContain(`file:   ${mdPath}`);
    expect(stdout).toContain('--');
    expect(stdout).toContain('[1]');
    expect(stdout).toContain('[2]');
    expect(stdout).toContain('renan (human)');
    expect(stdout).toContain('claude (llm)');
    expect(stdout).toContain('Does this still hold post-migration?');
    expect(stdout).toContain('Redis kept post-migration');
  });

  it('multi-line comment text: subsequent lines indented 4 spaces', async () => {
    const body = '# Cache\n\nRedis for session caching.\n';
    const anchor = {
      quote: 'Redis for session caching',
      startOffset: 9,
      endOffset: 34,
      xpath: '/html/body/p',
    };
    const thread = {
      id: 't-redis',
      resolved: false,
      comments: [
        {
          id: 'c-redis-1',
          threadId: 't-redis',
          author: 'renan',
          authorType: 'human',
          createdAt: '2026-04-27T10:00:00Z',
          text: 'First line.\nSecond line.\nThird line.',
          anchor,
        },
      ],
    };
    const mdPath = join(tmpDir, 'multiline.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli(['list-messages', mdPath, 't-redis']);
    expect(code).toBe(0);
    // Each line should be indented with 4 spaces
    expect(stdout).toContain('    First line.');
    expect(stdout).toContain('    Second line.');
    expect(stdout).toContain('    Third line.');
  });

  it('--json mode returns valid JSON with correct shape', async () => {
    const body = '# Cache\n\nRedis for session caching.\n';
    const anchor = {
      quote: 'Redis for session caching',
      startOffset: 9,
      endOffset: 34,
      xpath: '/html/body/p',
    };
    const thread = {
      id: 't-redis',
      resolved: false,
      comments: [
        {
          id: 'c-redis-1',
          threadId: 't-redis',
          author: 'renan',
          authorType: 'human',
          createdAt: '2026-04-27T10:00:00Z',
          text: 'Does this still hold?',
          anchor,
        },
        {
          id: 'c-redis-2',
          threadId: 't-redis',
          author: 'claude',
          authorType: 'llm',
          createdAt: '2026-04-27T11:05:00Z',
          text: 'Yes it does.',
          anchor,
        },
      ],
    };
    const mdPath = join(tmpDir, 'json_test.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli(['list-messages', mdPath, 't-redis', '--json']);
    expect(code).toBe(0);

    let parsed: any;
    expect(() => {
      parsed = JSON.parse(stdout);
    }).not.toThrow();

    expect(parsed).toHaveProperty('file', mdPath);
    expect(parsed).toHaveProperty('thread');
    expect(parsed.thread).toHaveProperty('id', 't-redis');
    expect(parsed.thread).toHaveProperty('status', 'open');
    expect(parsed.thread).toHaveProperty('anchor');
    expect(parsed.thread.anchor).toHaveProperty('quote', 'Redis for session caching');
    expect(parsed.thread).toHaveProperty('comments');
    expect(Array.isArray(parsed.thread.comments)).toBe(true);
    expect(parsed.thread.comments).toHaveLength(2);
    expect(parsed.thread.comments[0]).toHaveProperty('id', 'c-redis-1');
    expect(parsed.thread.comments[0]).toHaveProperty('author', 'renan');
    expect(parsed.thread.comments[0]).toHaveProperty('authorType', 'human');
    expect(parsed.thread.comments[0]).toHaveProperty('createdAt', '2026-04-27T10:00:00Z');
    expect(parsed.thread.comments[0]).toHaveProperty('text', 'Does this still hold?');
  });

  it('comments sorted ascending by createdAt even if stored out of order', async () => {
    const body = '# Cache\n\nRedis for session caching.\n';
    const anchor = {
      quote: 'Redis for session caching',
      startOffset: 9,
      endOffset: 34,
      xpath: '/html/body/p',
    };
    const thread = {
      id: 't-redis',
      resolved: false,
      comments: [
        // Stored out of order: later comment first
        {
          id: 'c-later',
          threadId: 't-redis',
          author: 'claude',
          authorType: 'llm',
          createdAt: '2026-04-27T12:00:00Z',
          text: 'Later reply.',
          anchor,
        },
        {
          id: 'c-earlier',
          threadId: 't-redis',
          author: 'renan',
          authorType: 'human',
          createdAt: '2026-04-27T10:00:00Z',
          text: 'Earlier question.',
          anchor,
        },
      ],
    };
    const mdPath = join(tmpDir, 'out_of_order.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    // Text output: earlier should appear as [1], later as [2]
    const { stdout, code } = await runCli(['list-messages', mdPath, 't-redis']);
    expect(code).toBe(0);
    const idx1 = stdout.indexOf('[1]');
    const earlierIdx = stdout.indexOf('Earlier question.');
    const idx2 = stdout.indexOf('[2]');
    const laterIdx = stdout.indexOf('Later reply.');
    // [1] block should contain earlier question
    expect(idx1).toBeLessThan(earlierIdx);
    expect(earlierIdx).toBeLessThan(idx2);
    expect(idx2).toBeLessThan(laterIdx);

    // JSON output: sorted by createdAt
    const { stdout: jsonOut } = await runCli(['list-messages', mdPath, 't-redis', '--json']);
    const parsed = JSON.parse(jsonOut);
    expect(parsed.thread.comments[0].id).toBe('c-earlier');
    expect(parsed.thread.comments[1].id).toBe('c-later');
  });

  it('id longer than 12 chars is truncated with … in text output', async () => {
    const body = '# Cache\n\nRedis for session caching.\n';
    const anchor = {
      quote: 'Redis for session caching',
      startOffset: 9,
      endOffset: 34,
      xpath: '/html/body/p',
    };
    const thread = {
      id: 't-redis',
      resolved: false,
      comments: [
        {
          id: 'c-1234567890abcdef', // > 12 chars
          threadId: 't-redis',
          author: 'renan',
          authorType: 'human',
          createdAt: '2026-04-27T10:00:00Z',
          text: 'A comment.',
          anchor,
        },
      ],
    };
    const mdPath = join(tmpDir, 'long_id.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli(['list-messages', mdPath, 't-redis']);
    expect(code).toBe(0);
    expect(stdout).toContain('…');
    // The full id should not appear in its long form in text output
    expect(stdout).not.toContain('c-1234567890abcdef');
  });
});

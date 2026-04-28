import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { startCliHarness, type CliHarness } from './_harness';

// ---------------------------------------------------------------------------
// Harness setup
// ---------------------------------------------------------------------------

let harness: CliHarness;
let tmpDir: string;
const runCli = (args: string[]) => harness.runCli(args);

beforeAll(async () => {
  harness = await startCliHarness('list-threads');
  tmpDir = harness.docsRoot;
});

afterAll(async () => {
  await harness.stop();
});

function commentBlock(threads: object[]): string {
  const payload = { version: '1', threads };
  return `\n\n<!-- mdreview-comments: ${JSON.stringify(payload)} -->\n`;
}

function makeThread(opts: {
  threadId?: string;
  commentId?: string;
  quote?: string;
  startOffset?: number;
  resolved?: boolean;
  author?: string;
  authorType?: string;
  createdAt?: string;
  text?: string;
} = {}): object {
  const threadId = opts.threadId ?? 't-abc123';
  const commentId = opts.commentId ?? 'c-abc123';
  const quote = opts.quote ?? 'Redis for session caching';
  const startOffset = opts.startOffset ?? 30;
  const resolved = opts.resolved ?? false;
  const author = opts.author ?? 'renan';
  const authorType = opts.authorType ?? 'human';
  const createdAt = opts.createdAt ?? '2026-04-27T10:00:00Z';
  const text = opts.text ?? 'Does this still hold?';
  return {
    id: threadId,
    resolved,
    comments: [
      {
        id: commentId,
        threadId,
        author,
        authorType,
        createdAt,
        text,
        anchor: {
          quote,
          startOffset,
          endOffset: startOffset + quote.length,
          xpath: '/html/body/p',
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('list-threads command', () => {
  it('missing file arg → exit 1 with usage in stderr', async () => {
    const { stderr, code } = await runCli(['list-threads']);
    expect(code).toBe(1);
    expect(stderr).toContain('usage');
    expect(stderr).toContain('list-threads');
  });

  it('file not found → exit 2', async () => {
    const { stderr, code } = await runCli(['list-threads', 'nonexistent-doc.md']);
    expect(code).toBe(2);
    expect(stderr).toContain('not_found');
  });

  it('empty file (no comment block) → exit 0, threads: 0, (no threads)', async () => {
    const mdPath = join(tmpDir, 'plain.md');
    await writeFile(mdPath, '# Hello\n\nJust some text.\n');

    const { stdout, code } = await runCli(['list-threads', mdPath]);
    expect(code).toBe(0);
    expect(stdout).toContain('threads: 0');
    expect(stdout).toContain('(no threads)');
  });

  it('two threads sorted by createdAt ascending', async () => {
    const body = '# Cache\n\nRedis for session caching.\n\nNative TTL per-key support.\n';
    const thread1 = makeThread({
      threadId: 't-redis',
      commentId: 'c-redis-1',
      quote: 'Redis for session caching',
      startOffset: 9,
      createdAt: '2026-04-27T10:00:00Z',
      text: 'Does this still hold post-migration?',
    });
    const thread2 = makeThread({
      threadId: 't-ttl',
      commentId: 'c-ttl-1',
      quote: 'Native TTL per-key',
      startOffset: 37,
      createdAt: '2026-04-27T11:00:00Z',
      text: 'Is this still accurate?',
      resolved: true,
    });
    // Store in reverse order to verify sorting
    const mdPath = join(tmpDir, 'two_threads.md');
    await writeFile(mdPath, body + commentBlock([thread2, thread1]));

    const { stdout, code } = await runCli(['list-threads', mdPath]);
    expect(code).toBe(0);
    // The earlier thread (t-redis, 10:00) should appear before the later one (t-ttl, 11:00)
    const redisIdx = stdout.indexOf('t-redis');
    const ttlIdx = stdout.indexOf('t-ttl');
    expect(redisIdx).toBeGreaterThanOrEqual(0);
    expect(ttlIdx).toBeGreaterThanOrEqual(0);
    expect(redisIdx).toBeLessThan(ttlIdx);
  });

  it('header shows correct open/resolved counts', async () => {
    const body = '# Cache\n\nRedis for session caching.\n\nNative TTL per-key support.\n';
    const thread1 = makeThread({
      threadId: 't-open',
      commentId: 'c-open-1',
      quote: 'Redis for session caching',
      startOffset: 9,
      resolved: false,
    });
    const thread2 = makeThread({
      threadId: 't-resolved',
      commentId: 'c-res-1',
      quote: 'Native TTL per-key',
      startOffset: 37,
      resolved: true,
    });
    const mdPath = join(tmpDir, 'mixed.md');
    await writeFile(mdPath, body + commentBlock([thread1, thread2]));

    const { stdout, code } = await runCli(['list-threads', mdPath]);
    expect(code).toBe(0);
    expect(stdout).toContain('threads: 2 (open: 1, resolved: 1)');
  });

  it('--json mode produces valid JSON with expected shape', async () => {
    const body = '# Cache\n\nRedis for session caching.\n';
    const thread = makeThread({
      threadId: 't-redis',
      commentId: 'c-redis-1',
      quote: 'Redis for session caching',
      startOffset: 9,
      createdAt: '2026-04-27T10:00:00Z',
      text: 'Does this still hold post-migration?',
    });
    const mdPath = join(tmpDir, 'json_test.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli(['list-threads', mdPath, '--json']);
    expect(code).toBe(0);

    let parsed: any;
    expect(() => {
      parsed = JSON.parse(stdout);
    }).not.toThrow();

    expect(parsed).toHaveProperty('file');
    expect(parsed).toHaveProperty('threads');
    expect(Array.isArray(parsed.threads)).toBe(true);
    expect(parsed.threads).toHaveLength(1);

    const t = parsed.threads[0];
    expect(t).toHaveProperty('id', 't-redis');
    expect(t).toHaveProperty('status', 'open');
    expect(t).toHaveProperty('commentCount', 1);
    expect(t).toHaveProperty('firstComment');
    expect(t.firstComment).toHaveProperty('id', 'c-redis-1');
    expect(t.firstComment).toHaveProperty('author', 'renan');
    expect(t.firstComment).toHaveProperty('authorType', 'human');
    expect(t.firstComment).toHaveProperty('createdAt', '2026-04-27T10:00:00Z');
    expect(t.firstComment).toHaveProperty('text', 'Does this still hold post-migration?');
    expect(t).toHaveProperty('anchor');
    expect(t.anchor).toHaveProperty('quote', 'Redis for session caching');
  });

  it('quote truncation: >60 chars truncated with … in text output, full in --json', async () => {
    const longQuote = 'This is a very long anchor quote that certainly exceeds sixty characters easily';
    const body = `# Heading\n\n${longQuote}\n`;
    const thread = makeThread({
      quote: longQuote,
      startOffset: 11,
    });
    const mdPath = join(tmpDir, 'long_quote.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    // Text output: quote truncated
    const { stdout: textOut, code: textCode } = await runCli(['list-threads', mdPath]);
    expect(textCode).toBe(0);
    expect(textOut).toContain('…');
    expect(textOut).not.toContain(longQuote);

    // JSON output: full quote preserved
    const { stdout: jsonOut, code: jsonCode } = await runCli(['list-threads', mdPath, '--json']);
    expect(jsonCode).toBe(0);
    const parsed = JSON.parse(jsonOut);
    expect(parsed.threads[0].anchor.quote).toBe(longQuote);
  });

  it('comment text truncation: >80 chars truncated with … in text output, full in --json', async () => {
    const longText = 'This is a very long comment text that definitely exceeds eighty characters in total length without a doubt';
    const body = '# Cache\n\nRedis for session caching.\n';
    const thread = makeThread({
      quote: 'Redis for session caching',
      startOffset: 9,
      text: longText,
    });
    const mdPath = join(tmpDir, 'long_text.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    // Text output: text truncated
    const { stdout: textOut, code: textCode } = await runCli(['list-threads', mdPath]);
    expect(textCode).toBe(0);
    expect(textOut).toContain('…');
    expect(textOut).not.toContain(longText);

    // JSON output: full text preserved
    const { stdout: jsonOut, code: jsonCode } = await runCli(['list-threads', mdPath, '--json']);
    expect(jsonCode).toBe(0);
    const parsed = JSON.parse(jsonOut);
    expect(parsed.threads[0].firstComment.text).toBe(longText);
  });

  it('singular "comment" for 1 comment, plural "comments" for 2', async () => {
    const body = '# Cache\n\nRedis for session caching.\n\nNative TTL per-key.\n';
    const thread1: any = makeThread({
      threadId: 't-single',
      commentId: 'c-s1',
      quote: 'Redis for session caching',
      startOffset: 9,
    });
    // Add a second comment to thread1
    const thread2: any = makeThread({
      threadId: 't-two',
      commentId: 'c-t1',
      quote: 'Native TTL per-key',
      startOffset: 37,
    });
    thread2.comments.push({
      id: 'c-t2',
      threadId: 't-two',
      author: 'claude',
      authorType: 'llm',
      createdAt: '2026-04-27T12:00:00Z',
      text: 'Second comment',
      anchor: thread2.comments[0].anchor,
    });
    const mdPath = join(tmpDir, 'plural.md');
    await writeFile(mdPath, body + commentBlock([thread1, thread2]));

    const { stdout, code } = await runCli(['list-threads', mdPath]);
    expect(code).toBe(0);
    expect(stdout).toContain('[1 comment]');
    expect(stdout).toContain('[2 comments]');
  });
});

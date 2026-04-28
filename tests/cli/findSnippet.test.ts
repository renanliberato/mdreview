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
  harness = await startCliHarness('findsnippet');
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
  quote: string;
  startOffset?: number;
  resolved?: boolean;
}): object {
  const threadId = opts.threadId ?? 't-abc123';
  const commentId = opts.commentId ?? 'c-abc123';
  const quote = opts.quote;
  const startOffset = opts.startOffset ?? 0;
  return {
    id: threadId,
    resolved: opts.resolved ?? false,
    comments: [
      {
        id: commentId,
        threadId,
        author: 'alice',
        authorType: 'human',
        createdAt: '2025-01-01T00:00:00.000Z',
        text: 'Review comment',
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

describe('find-snippet command', () => {
  it('missing args → exit 1, stderr contains usage', async () => {
    const { stderr, code } = await runCli(['find-snippet']);
    expect(code).toBe(1);
    expect(stderr).toContain('usage');
  });

  it('missing thread-id → exit 1, stderr contains usage', async () => {
    const mdPath = join(tmpDir, 'doc.md');
    await writeFile(mdPath, '# Hello\n');
    const { stderr, code } = await runCli(['find-snippet', mdPath]);
    expect(code).toBe(1);
    expect(stderr).toContain('usage');
  });

  it('missing file → exit 2, stderr contains not_found', async () => {
    const { stderr, code } = await runCli([
      'find-snippet',
      'nonexistent-findsnippet.md',
      't-abc123',
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('not_found');
  });

  it('unknown thread id → exit 3, stderr contains thread <id> not found', async () => {
    const body = '# Heading\n\nSome text here.\n';
    const thread = makeThread({ quote: 'Some text here', startOffset: 11 });
    const mdPath = join(tmpDir, 'doc.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stderr, code } = await runCli(['find-snippet', mdPath, 't-unknown']);
    expect(code).toBe(3);
    expect(stderr).toContain('thread t-unknown not found');
  });

  it('quote not present in doc → exit 4, stderr contains orphan', async () => {
    const body = '# Heading\n\nSome completely different text.\n';
    const thread = makeThread({
      quote: 'this quote does not appear anywhere in the document whatsoever',
      startOffset: 999,
    });
    const mdPath = join(tmpDir, 'orphan.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stderr, code } = await runCli(['find-snippet', mdPath, 't-abc123']);
    expect(code).toBe(4);
    expect(stderr).toContain('orphan');
  });

  it('happy path: stdout has thread:, quote:, match: line N col M (strategy: fuzzy), -- separator, and > prefix on hit line', async () => {
    const body =
      '# Architecture Decision Record: Cache Strategy\n\nWe decided to use Redis for session caching because the latency\nare under 5ms and Postgres would saturate under peak load.\n\n## Alternatives Considered\n';
    // quote present exactly in the doc so firstHit finds it with strategy "fuzzy"
    const quote = 'Redis for session caching';
    const thread = makeThread({ quote, startOffset: 999 }); // bad offset → won't exactNear, but firstHit will
    const mdPath = join(tmpDir, 'happy.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli(['find-snippet', mdPath, 't-abc123']);
    expect(code).toBe(0);
    expect(stdout).toContain('thread: t-abc123');
    expect(stdout).toContain(`quote:  "${quote}"`);
    expect(stdout).toMatch(/match:\s+line \d+, col \d+ \(strategy: fuzzy\)/);
    expect(stdout).toContain('--');
    expect(stdout).toContain('> ');
  });

  it('--context=0 → only the hit line shown', async () => {
    const body =
      'line one\nline two\nline three\nthe target quote lives here\nline five\nline six\n';
    const quote = 'the target quote lives here';
    const thread = makeThread({ quote, startOffset: 999 });
    const mdPath = join(tmpDir, 'ctx0.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli([
      'find-snippet',
      mdPath,
      't-abc123',
      '--context=0',
    ]);
    expect(code).toBe(0);
    // Only one line in context block (the hit line with > prefix)
    const contextBlock = stdout.split('--\n')[1];
    const contextLines = contextBlock.trim().split('\n');
    expect(contextLines).toHaveLength(1);
    expect(contextLines[0]).toMatch(/^>/);
  });

  it('--context=2 → 2 lines before + hit + 2 after', async () => {
    const body =
      'line one\nline two\nline three\nthe target quote lives here\nline five\nline six\nline seven\n';
    const quote = 'the target quote lives here';
    const thread = makeThread({ quote, startOffset: 999 });
    const mdPath = join(tmpDir, 'ctx2.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli([
      'find-snippet',
      mdPath,
      't-abc123',
      '--context=2',
    ]);
    expect(code).toBe(0);
    // 2 before + 1 hit + 2 after = 5 lines
    const contextBlock = stdout.split('--\n')[1];
    const contextLines = contextBlock.trim().split('\n');
    expect(contextLines).toHaveLength(5);
    // The middle line (index 2) should have the > prefix
    expect(contextLines[2]).toMatch(/^>/);
    // Lines before and after should not have > prefix
    expect(contextLines[0]).not.toMatch(/^>/);
    expect(contextLines[4]).not.toMatch(/^>/);
  });

  it('--context=2 at file boundary → fewer lines (no error)', async () => {
    const body = 'first line\nsecond line\n';
    const quote = 'first line';
    const thread = makeThread({ quote, startOffset: 0 });
    const mdPath = join(tmpDir, 'boundary.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli([
      'find-snippet',
      mdPath,
      't-abc123',
      '--context=2',
    ]);
    expect(code).toBe(0);
    // Hit is at line 1, so no lines before it; 2 after → 3 total
    const contextBlock = stdout.split('--\n')[1];
    const contextLines = contextBlock.trim().split('\n');
    expect(contextLines.length).toBeLessThan(5);
    expect(contextLines[0]).toMatch(/^>/); // first line is the hit
  });

  it('tokenPrefix match → strategy: line-search', async () => {
    // Doc has "Quick brown fox jumps over the lazy dog"
    // Quote has a slight variation at the end so firstHit cannot find the exact string,
    // but tokenPrefix will match the first 4 tokens "Quick brown fox jumps"
    const body = '# Heading\n\nQuick brown fox jumps over the lazy dog.\n';
    const thread = makeThread({
      quote: 'Quick brown fox jumps over a lazy horse', // not literally in doc
      startOffset: 999,
    });
    const mdPath = join(tmpDir, 'linesearch.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli(['find-snippet', mdPath, 't-abc123']);
    expect(code).toBe(0);
    expect(stdout).toContain('strategy: line-search');
  });

  it('bad --context=foo → exit 1, stderr contains --context must be a non-negative integer', async () => {
    const body = '# Heading\n\nSome text.\n';
    const thread = makeThread({ quote: 'Some text', startOffset: 11 });
    const mdPath = join(tmpDir, 'doc.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stderr, code } = await runCli([
      'find-snippet',
      mdPath,
      't-abc123',
      '--context=foo',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('--context must be a non-negative integer');
  });

  it('bad --context=-1 → exit 1, stderr contains --context must be a non-negative integer', async () => {
    const body = '# Heading\n\nSome text.\n';
    const thread = makeThread({ quote: 'Some text', startOffset: 11 });
    const mdPath = join(tmpDir, 'doc.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stderr, code } = await runCli([
      'find-snippet',
      mdPath,
      't-abc123',
      '--context=-1',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('--context must be a non-negative integer');
  });

  it('sample stdout block matches expected format', async () => {
    const body =
      '# Architecture Decision Record: Cache Strategy\n\nWe decided to use Redis for session caching because the latency\nare under 5ms and Postgres would saturate under peak load.\n\n## Alternatives Considered\n';
    const quote = 'Redis for session caching';
    const thread = makeThread({ threadId: 't-abc123', quote, startOffset: 999 });
    const mdPath = join(tmpDir, 'sample.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli([
      'find-snippet',
      mdPath,
      't-abc123',
      '--context=3',
    ]);
    expect(code).toBe(0);

    // Verify all 4 output sections are present
    const lines = stdout.split('\n');
    expect(lines[0]).toBe('thread: t-abc123');
    expect(lines[1]).toBe(`quote:  "${quote}"`);
    expect(lines[2]).toMatch(/^match:\s+line \d+, col \d+ \(strategy: fuzzy\)$/);
    expect(lines[3]).toBe('--');
    // Context block follows — at least one line with > prefix
    const hasHitLine = lines.slice(4).some((l) => l.startsWith('>'));
    expect(hasHitLine).toBe(true);
  });
});

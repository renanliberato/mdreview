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
  harness = await startCliHarness('validate');
  tmpDir = harness.docsRoot;
});

afterAll(async () => {
  await harness.stop();
});

function commentBlock(threads: object[]): string {
  const payload = { version: '1', threads };
  return `\n\n<!-- mdreview-comments: ${JSON.stringify(payload)} -->\n`;
}

function makeThread(
  opts: {
    threadId?: string;
    commentId?: string;
    quote?: string;
    startOffset?: number;
    resolved?: boolean;
    commentThreadId?: string; // override the comment's threadId (for mismatch test)
  } = {},
): object {
  const threadId = opts.threadId ?? 't-abc123';
  const commentId = opts.commentId ?? 'c-abc123';
  const quote = opts.quote ?? 'Redis for session caching';
  const startOffset = opts.startOffset ?? 30;
  const resolved = opts.resolved ?? false;
  const commentThreadId = opts.commentThreadId ?? threadId;
  return {
    id: threadId,
    resolved,
    comments: [
      {
        id: commentId,
        threadId: commentThreadId,
        author: 'alice',
        authorType: 'human',
        createdAt: '2025-01-01T00:00:00.000Z',
        text: 'Looks good',
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

describe('validate command', () => {
  it('missing file argument → exit 1, stderr contains usage', async () => {
    const { stderr, code } = await runCli(['validate']);
    expect(code).toBe(1);
    expect(stderr).toContain('usage');
  });

  it('non-existent file → exit 2, stderr contains not_found', async () => {
    const { stderr, code } = await runCli(['validate', 'nonexistent-validate.md']);
    expect(code).toBe(2);
    expect(stderr).toContain('not_found');
  });

  it('clean file with no comment block → exit 0, zero threads', async () => {
    const mdPath = join(tmpDir, 'plain.md');
    await writeFile(mdPath, '# Hello\n\nJust some text.\n');

    const { stdout, code } = await runCli(['validate', mdPath]);
    expect(code).toBe(0);
    expect(stdout).toContain('threads: 0');
    expect(stdout).toContain('result: 0 warnings, 0 errors');
  });

  it('clean file with one exact-match thread → exit 0, [OK] match=exact', async () => {
    const body = '# Cache Strategy\n\nWe decided to use Redis for session caching because latency is low.\n';
    const thread = makeThread({ quote: 'Redis for session caching', startOffset: 30 });
    const mdPath = join(tmpDir, 'clean_exact.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli(['validate', mdPath]);
    expect(code).toBe(0);
    expect(stdout).toContain('[OK]');
    expect(stdout).toContain('match=exact');
    expect(stdout).toContain('result: 0 warnings, 0 errors');
  });

  it('clean file with two threads: one exact, one fuzzy via shifted offset → exit 0, both [OK]', async () => {
    const body =
      '# Cache Strategy\n\nWe decided to use Redis for session caching because latency is low.\n\nTTL defaults are 300 seconds.\n';
    // thread 1: quote at ~30, stored offset 30 → exact
    const thread1 = makeThread({
      threadId: 't-001',
      commentId: 'c-001',
      quote: 'Redis for session caching',
      startOffset: 30,
    });
    // thread 2: quote at ~76, stored offset 200 (far away) → fuzzy (firstHit)
    const thread2 = makeThread({
      threadId: 't-002',
      commentId: 'c-002',
      quote: 'TTL defaults are 300 seconds',
      startOffset: 200, // offset differs by >50, but firstHit finds it
    });
    const mdPath = join(tmpDir, 'two_threads.md');
    await writeFile(mdPath, body + commentBlock([thread1, thread2]));

    const { stdout, code } = await runCli(['validate', mdPath]);
    expect(code).toBe(0);
    expect(stdout).toContain('[OK]');
    // At least one exact and output has two OK lines
    const okCount = (stdout.match(/\[OK\]/g) ?? []).length;
    expect(okCount).toBe(2);
    expect(stdout).toContain('result: 0 warnings, 0 errors');
  });

  it('orphan thread → exit 4, stdout contains [WARN] and orphan', async () => {
    const body = '# Cache Strategy\n\nSome totally different text here.\n';
    const thread = makeThread({ quote: 'this text does not appear anywhere in the document at all' });
    const mdPath = join(tmpDir, 'orphan.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli(['validate', mdPath]);
    expect(code).toBe(4);
    expect(stdout).toContain('[WARN]');
    expect(stdout).toContain('orphan');
  });

  it('duplicate thread id → exit 4, stdout contains [ERROR] and duplicate id', async () => {
    const body = '# Cache Strategy\n\nWe use Redis for session caching in our stack.\n';
    const thread1 = makeThread({ threadId: 't-dup', commentId: 'c-001', quote: 'Redis for session caching', startOffset: 22 });
    const thread2 = makeThread({ threadId: 't-dup', commentId: 'c-002', quote: 'Redis for session caching', startOffset: 22 });
    const mdPath = join(tmpDir, 'dup_id.md');
    await writeFile(mdPath, body + commentBlock([thread1, thread2]));

    const { stdout, code } = await runCli(['validate', mdPath]);
    expect(code).toBe(4);
    expect(stdout).toContain('[ERROR]');
    expect(stdout).toContain('duplicate id');
  });

  it('duplicate comment id across threads → exit 4, stdout contains [ERROR] and duplicate id', async () => {
    const body = '# Cache Strategy\n\nWe use Redis for session caching.\n\nAlso TTL defaults apply.\n';
    const thread1 = makeThread({ threadId: 't-001', commentId: 'c-shared', quote: 'Redis for session caching', startOffset: 22 });
    const thread2 = makeThread({ threadId: 't-002', commentId: 'c-shared', quote: 'TTL defaults apply', startOffset: 55 });
    const mdPath = join(tmpDir, 'dup_comment_id.md');
    await writeFile(mdPath, body + commentBlock([thread1, thread2]));

    const { stdout, code } = await runCli(['validate', mdPath]);
    expect(code).toBe(4);
    expect(stdout).toContain('[ERROR]');
    expect(stdout).toContain('duplicate id');
  });

  it('threadId mismatch → exit 4, stdout contains [ERROR] and threadId', async () => {
    const body = '# Cache Strategy\n\nWe use Redis for session caching.\n';
    // Comment's threadId intentionally points to a different thread
    const thread = makeThread({
      threadId: 't-parent',
      commentId: 'c-001',
      quote: 'Redis for session caching',
      startOffset: 22,
      commentThreadId: 't-other', // mismatch!
    });
    const mdPath = join(tmpDir, 'threadid_mismatch.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli(['validate', mdPath]);
    expect(code).toBe(4);
    expect(stdout).toContain('[ERROR]');
    expect(stdout).toContain('threadId');
  });

  it('malformed JSON in comment block → exit 4, stdout contains [ERROR] and malformed', async () => {
    const body = '# Cache Strategy\n\nWe use Redis for session caching.\n';
    // Manually craft a malformed block (valid regex match but bad JSON)
    const badBlock = '\n\n<!-- mdreview-comments: { "version": "1", "threads": [ INVALID } -->\n';
    const mdPath = join(tmpDir, 'malformed.md');
    await writeFile(mdPath, body + badBlock);

    const { stdout, code } = await runCli(['validate', mdPath]);
    expect(code).toBe(4);
    expect(stdout).toContain('[ERROR]');
    expect(stdout).toContain('malformed');
  });

  it('--json mode on clean file → exit 0, valid JSON with expected shape', async () => {
    const body = '# Cache Strategy\n\nWe decided to use Redis for session caching because latency.\n';
    const thread = makeThread({ quote: 'Redis for session caching', startOffset: 30 });
    const mdPath = join(tmpDir, 'clean_json.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli(['validate', mdPath, '--json']);
    expect(code).toBe(0);

    let parsed: any;
    expect(() => {
      parsed = JSON.parse(stdout);
    }).not.toThrow();

    expect(parsed).toHaveProperty('file');
    expect(parsed).toHaveProperty('threads');
    expect(parsed).toHaveProperty('errors');
    expect(parsed).toHaveProperty('warnings');
    expect(Array.isArray(parsed.threads)).toBe(true);
    expect(Array.isArray(parsed.errors)).toBe(true);
    expect(Array.isArray(parsed.warnings)).toBe(true);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.warnings).toHaveLength(0);
    expect(parsed.threads[0]).toHaveProperty('id', 't-abc123');
    expect(parsed.threads[0]).toHaveProperty('strategy');
    expect(parsed.threads[0]).toHaveProperty('line');
    expect(parsed.threads[0]).toHaveProperty('quote');
    expect(parsed.threads[0]).toHaveProperty('issues');
  });

  it('--json mode on orphan file → exit 4, warnings array populated', async () => {
    const body = '# Cache Strategy\n\nSome text here.\n';
    const thread = makeThread({ quote: 'completely absent text that is not in the doc' });
    const mdPath = join(tmpDir, 'orphan_json.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli(['validate', mdPath, '--json']);
    expect(code).toBe(4);

    const parsed = JSON.parse(stdout);
    expect(parsed.warnings.length).toBeGreaterThan(0);
    expect(parsed.threads[0].strategy).toBeNull();
    expect(parsed.threads[0].line).toBeNull();
    expect(parsed.threads[0].issues).toContain('orphan');
  });

  it('resolved thread is counted correctly in header', async () => {
    const body = '# Cache Strategy\n\nWe use Redis for session caching.\n';
    const thread = makeThread({
      quote: 'Redis for session caching',
      startOffset: 22,
      resolved: true,
    });
    const mdPath = join(tmpDir, 'resolved.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli(['validate', mdPath]);
    expect(code).toBe(0);
    expect(stdout).toContain('threads: 1 (open: 0, resolved: 1)');
  });

  it('quote longer than 60 chars is truncated in text output', async () => {
    const longQuote = 'This is a very long quote that exceeds sixty characters in total length for sure';
    const body = `# Heading\n\n${longQuote}\n`;
    const thread = makeThread({ quote: longQuote, startOffset: 11 });
    const mdPath = join(tmpDir, 'long_quote.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli(['validate', mdPath]);
    expect(code).toBe(0);
    expect(stdout).toContain('…');
  });

  it('strategy line-search is shown as match=line-search', async () => {
    // Quote differs slightly so exactNear and firstHit won't find the exact string,
    // but first tokens will match.
    const body = '# Heading\n\nQuick brown fox jumps over the lazy dog here.\n';
    // Quote has words that partially match via tokenPrefix but not exact/firstHit
    const thread = makeThread({
      quote: 'Quick brown fox jumps', // tokens: Quick brown fox jumps
      startOffset: 500, // far off so exactNear fails; exact string present so firstHit will match
    });
    // Since the exact string IS in the doc, firstHit will find it.
    // To force line-search, use a quote with a slight variation that's not literally in the doc
    const thread2 = makeThread({
      threadId: 't-linesearch',
      commentId: 'c-linesearch',
      quote: 'Quick brown fox jumps over a lazy horse', // not exact in doc
      startOffset: 500,
    });
    const mdPath = join(tmpDir, 'linesearch.md');
    await writeFile(mdPath, body + commentBlock([thread2]));

    const { stdout } = await runCli(['validate', mdPath]);
    // tokenPrefix for 'Quick brown fox jumps over a lazy horse' → 'Quick brown fox jumps'
    // which IS in the doc → strategy line-search
    expect(stdout).toContain('match=line-search');
  });
});

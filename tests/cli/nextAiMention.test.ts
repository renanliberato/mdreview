import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { startCliHarness, type CliHarness } from './_harness';

let h: CliHarness;

beforeAll(async () => {
  h = await startCliHarness('next-ai-mention');
});

afterAll(async () => {
  await h.stop();
});

function commentBlock(threads: object[]): string {
  const payload = { version: '1', threads };
  return `\n\n<!-- mdreview-comments: ${JSON.stringify(payload)} -->\n`;
}

function makeThread(opts: {
  threadId?: string;
  comments: Array<{
    id?: string;
    text: string;
    author?: string;
    authorType?: string;
    createdAt?: string;
  }>;
  quote?: string;
  startOffset?: number;
  resolved?: boolean;
}): object {
  const threadId = opts.threadId ?? 't-abc123';
  const quote = opts.quote ?? 'Some text here';
  const startOffset = opts.startOffset ?? 0;
  return {
    id: threadId,
    resolved: opts.resolved ?? false,
    comments: opts.comments.map((c, i) => ({
      id: c.id ?? `c-${i}`,
      threadId,
      author: c.author ?? 'alice',
      authorType: c.authorType ?? 'human',
      createdAt: c.createdAt ?? '2025-01-01T00:00:00.000Z',
      text: c.text,
      anchor: {
        quote,
        startOffset,
        endOffset: startOffset + quote.length,
        xpath: '/html/body/p',
      },
    })),
  };
}

const DOC_BODY = '# Heading\n\nSome text here.\n\nMore content below.\n';

describe('next-ai-mention command', () => {
  it('missing file → exit 1, stderr contains usage', async () => {
    const { stderr, code } = await h.runCli(['next-ai-mention']);
    expect(code).toBe(1);
    expect(stderr).toContain('usage');
  });

  it('file not found → exit 2, stderr contains not_found', async () => {
    const { stderr, code } = await h.runCli(['next-ai-mention', 'nonexistent.md']);
    expect(code).toBe(2);
    expect(stderr).toContain('not_found');
  });

  it('malformed --context → exit 1, stderr contains --context must be a non-negative integer', async () => {
    await h.writeDoc('ctx-bad.md', DOC_BODY + commentBlock([
      makeThread({ comments: [{ text: '@ai please help' }] }),
    ]));
    const { stderr, code } = await h.runCli(['next-ai-mention', 'ctx-bad.md', '--context=foo']);
    expect(code).toBe(1);
    expect(stderr).toContain('--context must be a non-negative integer');
  });

  it('malformed --context negative → exit 1', async () => {
    await h.writeDoc('ctx-neg.md', DOC_BODY + commentBlock([
      makeThread({ comments: [{ text: '@ai please help' }] }),
    ]));
    const { stderr, code } = await h.runCli(['next-ai-mention', 'ctx-neg.md', '--context=-1']);
    expect(code).toBe(1);
    expect(stderr).toContain('--context must be a non-negative integer');
  });

  it('no matching thread → exit 5, no stderr output', async () => {
    await h.writeDoc('no-match.md', DOC_BODY + commentBlock([
      makeThread({ comments: [{ text: 'just a comment, no mention' }] }),
    ]));
    const { stderr, code } = await h.runCli(['next-ai-mention', 'no-match.md']);
    expect(code).toBe(5);
    expect(stderr).toBe('');
  });

  it('happy path: stdout has thread:, prompt:, quote:, match:, --, context block with > prefix', async () => {
    await h.writeDoc('happy.md', DOC_BODY + commentBlock([
      makeThread({
        threadId: 't-happy',
        quote: 'Some text here',
        startOffset: 11,
        comments: [
          { text: 'Initial comment', createdAt: '2025-01-01T00:00:00.000Z' },
          { text: '@ai please review this', createdAt: '2025-01-02T00:00:00.000Z' },
        ],
      }),
    ]));
    const { stdout, code } = await h.runCli(['next-ai-mention', 'happy.md']);
    expect(code).toBe(0);
    expect(stdout).toContain('thread: t-happy');
    expect(stdout).toContain('prompt: @ai please review this');
    expect(stdout).toContain('quote:  "Some text here"');
    expect(stdout).toMatch(/match:\s+line \d+, col \d+ \(strategy: (exact|fuzzy|line-search)\)/);
    expect(stdout).toContain('--');
    expect(stdout).toContain('> ');
  });

  it('--json flag: exits 0, stdout is valid JSON with thread and snippet', async () => {
    await h.writeDoc('json.md', DOC_BODY + commentBlock([
      makeThread({
        threadId: 't-json',
        quote: 'Some text here',
        startOffset: 11,
        comments: [{ text: '@ai summarize' }],
      }),
    ]));
    const { stdout, code } = await h.runCli(['next-ai-mention', 'json.md', '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as {
      thread: { id: string };
      snippet: { quote: string; line: number; col: number; strategy: string; contextBlock: string };
    };
    expect(parsed.thread.id).toBe('t-json');
    expect(parsed.snippet).toBeDefined();
    expect(typeof parsed.snippet.quote).toBe('string');
    expect(typeof parsed.snippet.line).toBe('number');
    expect(typeof parsed.snippet.col).toBe('number');
    expect(typeof parsed.snippet.contextBlock).toBe('string');
  });

  it('--context=N is propagated to the snippet', async () => {
    const body = 'line one\nline two\nSome text here\nline four\nline five\n';
    await h.writeDoc('ctx-prop.md', body + commentBlock([
      makeThread({
        quote: 'Some text here',
        startOffset: 19,
        comments: [{ text: '@ai check this' }],
      }),
    ]));
    const { stdout: stdout0 } = await h.runCli(['next-ai-mention', 'ctx-prop.md', '--context=0']);
    const { stdout: stdout2 } = await h.runCli(['next-ai-mention', 'ctx-prop.md', '--context=2']);

    const block0 = stdout0.split('--\n')[1]?.trim().split('\n') ?? [];
    const block2 = stdout2.split('--\n')[1]?.trim().split('\n') ?? [];
    expect(block0.length).toBe(1);
    expect(block2.length).toBeGreaterThan(1);
  });

  it('orphan: human output has thread id, prompt, and orphan line; exit 0', async () => {
    await h.writeDoc('orphan-human.md', DOC_BODY + commentBlock([
      makeThread({
        threadId: 't-orphan',
        quote: 'XYZZY_NONEXISTENT_TEXT_THAT_CANNOT_BE_FOUND',
        startOffset: 9999,
        comments: [{ text: '@ai please help', createdAt: '2025-01-01T00:00:00.000Z' }],
      }),
    ]));
    const { stdout, code } = await h.runCli(['next-ai-mention', 'orphan-human.md']);
    expect(code).toBe(0);
    expect(stdout).toContain('thread: t-orphan');
    expect(stdout).toContain('prompt: @ai please help');
    expect(stdout).toContain('(orphan: anchor no longer resolves)');
    expect(stdout).not.toContain('quote:');
    expect(stdout).not.toContain('match:');
  });

  it('orphan: --json output has snippet: null; exit 0', async () => {
    await h.writeDoc('orphan-json.md', DOC_BODY + commentBlock([
      makeThread({
        threadId: 't-orphan-json',
        quote: 'XYZZY_NONEXISTENT_TEXT_THAT_CANNOT_BE_FOUND',
        startOffset: 9999,
        comments: [{ text: '@ai check this', createdAt: '2025-01-01T00:00:00.000Z' }],
      }),
    ]));
    const { stdout, code } = await h.runCli(['next-ai-mention', 'orphan-json.md', '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout) as { thread: { id: string }; snippet: null };
    expect(parsed.thread.id).toBe('t-orphan-json');
    expect(parsed.snippet).toBeNull();
  });

  it('ordering: picks oldest last-comment createdAt across two matching threads', async () => {
    const body = '# Doc\n\nSome text here.\n\nMore text here.\n';
    await h.writeDoc('ordering.md', body + commentBlock([
      makeThread({
        threadId: 't-newer',
        quote: 'More text here',
        startOffset: 23,
        comments: [{ text: '@ai help', createdAt: '2025-06-01T00:00:00.000Z' }],
      }),
      makeThread({
        threadId: 't-older',
        quote: 'Some text here',
        startOffset: 7,
        comments: [{ text: '@ai help', createdAt: '2025-01-01T00:00:00.000Z' }],
      }),
    ]));
    const { stdout, code } = await h.runCli(['next-ai-mention', 'ordering.md']);
    expect(code).toBe(0);
    expect(stdout).toContain('thread: t-older');
  });
});

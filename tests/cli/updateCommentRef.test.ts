import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { spawn } from 'bun';
import { writeFile, readFile, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseCommentBlock, stripCommentBlock, serializeCommentBlock } from '../../src/shared/commentBlock';
import { sourceToPlainText } from '../../src/cli/lib/offsetBridge';

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
// Temp-dir fixture helpers
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'mdreview-updateref-'));
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
  commentId?: string;
  quote: string;
  startOffset?: number;
  endOffset?: number;
  xpath?: string;
  resolved?: boolean;
}): object {
  const threadId = opts.threadId ?? 't-abc123';
  const commentId = opts.commentId ?? 'c-abc123';
  const quote = opts.quote;
  const startOffset = opts.startOffset ?? 0;
  const endOffset = opts.endOffset ?? startOffset + quote.length;
  const xpath = opts.xpath ?? '/html/body/p';
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
          endOffset,
          xpath,
        },
      },
    ],
  };
}

function makeThreadWithTwoComments(opts: {
  threadId?: string;
  quote: string;
  startOffset?: number;
  xpath?: string;
}): object {
  const threadId = opts.threadId ?? 't-abc123';
  const quote = opts.quote;
  const startOffset = opts.startOffset ?? 0;
  const xpath = opts.xpath ?? '/html/body/p';
  const anchor = {
    quote,
    startOffset,
    endOffset: startOffset + quote.length,
    xpath,
  };
  return {
    id: threadId,
    resolved: false,
    comments: [
      {
        id: 'c-first',
        threadId,
        author: 'alice',
        authorType: 'human',
        createdAt: '2025-01-01T00:00:00.000Z',
        text: 'First comment',
        anchor: { ...anchor },
      },
      {
        id: 'c-second',
        threadId,
        author: 'bob',
        authorType: 'human',
        createdAt: '2025-01-02T00:00:00.000Z',
        text: 'Second comment',
        anchor: { ...anchor },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('update-comment-ref command', () => {
  // ── Error cases ──────────────────────────────────────────────────────────

  it('missing positionals → exit 1', async () => {
    const { stderr, code } = await runCli(['update-comment-ref']);
    expect(code).toBe(1);
    expect(stderr).toContain('usage');
  });

  it('missing thread-id positional → exit 1', async () => {
    const { stderr, code } = await runCli(['update-comment-ref', '/some/file.md']);
    expect(code).toBe(1);
    expect(stderr).toContain('usage');
  });

  it('file not found → exit 2', async () => {
    const { stderr, code } = await runCli([
      'update-comment-ref',
      '/nonexistent/path/doc.md',
      't-abc123',
      '--quote=anything',
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('not_found');
  });

  it('unknown thread id → exit 3', async () => {
    const body = '# Hello\n\nSome text.\n';
    const thread = makeThread({ quote: 'Some text', startOffset: 9 });
    const mdPath = join(tmpDir, 'doc.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stderr, code } = await runCli([
      'update-comment-ref',
      mdPath,
      't-unknown',
      '--quote=anything',
    ]);
    expect(code).toBe(3);
    expect(stderr).toContain('thread t-unknown not found');
  });

  it('no anchor flags → exit 1 with "at least one of" in stderr', async () => {
    const body = '# Hello\n\nSome text.\n';
    const thread = makeThread({ quote: 'Some text', startOffset: 9 });
    const mdPath = join(tmpDir, 'doc.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stderr, code } = await runCli([
      'update-comment-ref',
      mdPath,
      't-abc123',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('at least one of');
  });

  it('--start=foo (non-numeric) → exit 1', async () => {
    const body = '# Hello\n\nSome text.\n';
    const thread = makeThread({ quote: 'Some text', startOffset: 9 });
    const mdPath = join(tmpDir, 'doc.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stderr, code } = await runCli([
      'update-comment-ref',
      mdPath,
      't-abc123',
      '--start=foo',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('--start must be a non-negative integer');
  });

  it('--start=-1 (negative) → exit 1', async () => {
    const body = '# Hello\n\nSome text.\n';
    const thread = makeThread({ quote: 'Some text', startOffset: 9 });
    const mdPath = join(tmpDir, 'doc.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stderr, code } = await runCli([
      'update-comment-ref',
      mdPath,
      't-abc123',
      '--start=-1',
    ]);
    expect(code).toBe(1);
    // -1 is not a non-negative integer
    expect(stderr).toContain('--start must be a non-negative integer');
  });

  it('--end=5 --start=10 (end < start) → exit 1', async () => {
    const body = '# Hello\n\nSome text.\n';
    const thread = makeThread({ quote: 'Some text', startOffset: 9 });
    const mdPath = join(tmpDir, 'doc.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stderr, code } = await runCli([
      'update-comment-ref',
      mdPath,
      't-abc123',
      '--start=10',
      '--end=5',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('--end must be >= --start');
  });

  it('--start=99999 (out of doc bounds) → exit 1', async () => {
    const body = '# Hello\n\nSome text.\n';
    const thread = makeThread({ quote: 'Some text', startOffset: 9 });
    const mdPath = join(tmpDir, 'doc.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stderr, code } = await runCli([
      'update-comment-ref',
      mdPath,
      't-abc123',
      '--start=99999',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('out of doc bounds');
  });

  // ── Happy-path: --quote only ─────────────────────────────────────────────

  it('happy path: --quote="new quote" updates anchor.quote; startOffset/endOffset/xpath preserved', async () => {
    const body = '# Hello\n\nSome text here.\n';
    const thread = makeThread({
      quote: 'Some text here',
      startOffset: 5,
      endOffset: 19,
      xpath: '/html/body/p',
    });
    const mdPath = join(tmpDir, 'doc.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, stderr, code } = await runCli([
      'update-comment-ref',
      mdPath,
      't-abc123',
      '--quote=new quote',
    ]);

    expect(code).toBe(0);
    expect(stderr).toBe('');

    // stdout is one line of compact JSON
    const lines = stdout.split('\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.quote).toBe('new quote');

    // Other anchor fields preserved from comments[0]'s prior anchor
    expect(parsed.startOffset).toBe(5);
    expect(parsed.endOffset).toBe(19);
    expect(parsed.xpath).toBe('/html/body/p');

    // Verify the file on disk
    const updatedRaw = await readFile(mdPath, 'utf8');
    const threads = parseCommentBlock(updatedRaw);
    expect(threads[0].comments[0].anchor.quote).toBe('new quote');
  });

  // ── Happy-path: --quote + --start (raw→plain conversion) ────────────────

  it('happy path: --quote="redis" --start=<raw-offset> → persisted startOffset is plain-text offset', async () => {
    // Build a document with a heading so there are markup chars to skip
    // "# Cache Strategy\n\nWe use redis for caching.\n"
    //  ^0               ^17^18^19                    ^43
    // "# " is 2 chars of markup; "Cache Strategy" starts at raw offset 2
    // "\n\n" is the blank separator between heading and paragraph
    // "We use redis for caching." starts at raw offset 19
    // "redis" is at raw offset 25 (19 + "We use ".length = 19 + 6 = 25, "We use " is 7 chars
    //  but the paragraph starts at 19: 'W'=19, 'e'=20, ' '=21, 'u'=22, 's'=23, 'e'=24, ' '=25... wait:
    //  'W'=19,'e'=20,' '=21,'u'=22,'s'=23,'e'=24,' '=25,'r'=26 — but indexOf reports 25 in practice)
    const body = '# Cache Strategy\n\nWe use redis for caching.\n';
    const rawStripped = body; // no comment block yet for offset calc

    // Verify our expected raw offset for "redis"
    const redisRawOffset = body.indexOf('redis');
    // "# Cache Strategy\n\n" is 19 chars, "We use " is 7 chars → 19+7=26? Let's trust indexOf
    expect(redisRawOffset).toBeGreaterThan(0); // sanity check: redis is in the string

    const thread = makeThread({
      quote: 'redis',
      startOffset: 0, // initial plain-text offset (will be overwritten)
    });
    const mdPath = join(tmpDir, 'redis.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli([
      'update-comment-ref',
      mdPath,
      't-abc123',
      `--quote=redis`,
      `--start=${redisRawOffset}`,
    ]);

    expect(code).toBe(0);

    // Compute expected plain-text offset using sourceToPlainText directly
    // (rawStripped = body since stripCommentBlock removes the comment block)
    const expectedPlainStart = sourceToPlainText(rawStripped, redisRawOffset);
    // "redis" in the plain-text stream: "Cache Strategy" (14) + inter-block gap (1) + "We use " (7) = 22
    // Let's verify with the function call

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.quote).toBe('redis');
    expect(parsed.startOffset).toBe(expectedPlainStart);
    // endOffset should be sourceToPlainText(rawStripped, redisRawOffset + "redis".length)
    const expectedPlainEnd = sourceToPlainText(rawStripped, redisRawOffset + 'redis'.length);
    expect(parsed.endOffset).toBe(expectedPlainEnd);
  });

  // ── Multi-comment propagation ────────────────────────────────────────────

  it('multi-comment propagation: --xpath="/new/path" updates anchor.xpath on ALL comments', async () => {
    const body = '# Hello\n\nSome text here.\n';
    const thread = makeThreadWithTwoComments({
      quote: 'Some text here',
      startOffset: 5,
      xpath: '/html/body/p',
    });
    const mdPath = join(tmpDir, 'multi.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli([
      'update-comment-ref',
      mdPath,
      't-abc123',
      '--xpath=/new/path',
    ]);

    expect(code).toBe(0);

    const updatedRaw = await readFile(mdPath, 'utf8');
    const threads = parseCommentBlock(updatedRaw);
    expect(threads[0].comments).toHaveLength(2);

    // Both comments must have the updated xpath
    for (const c of threads[0].comments) {
      expect(c.anchor.xpath).toBe('/new/path');
    }

    // Other fields preserved from original comments[0].anchor
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.xpath).toBe('/new/path');
    expect(parsed.quote).toBe('Some text here');
    expect(parsed.startOffset).toBe(5);
  });

  // ── --end recompute from --quote + --start ───────────────────────────────

  it('--end recompute: --quote="abc" --start=N → endOffset = sourceToPlainText(raw, N) + 3', async () => {
    // Plain text document (no markup) so raw offset === plain-text offset
    const body = 'Hello abc world\n';
    // "abc" starts at raw offset 6
    const abcRawOffset = body.indexOf('abc');
    expect(abcRawOffset).toBe(6);

    const thread = makeThread({ quote: 'Hello abc world', startOffset: 0 });
    const mdPath = join(tmpDir, 'abc.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli([
      'update-comment-ref',
      mdPath,
      't-abc123',
      '--quote=abc',
      `--start=${abcRawOffset}`,
    ]);

    expect(code).toBe(0);

    const parsed = JSON.parse(stdout.trim());
    expect(parsed.quote).toBe('abc');

    // For plain text, sourceToPlainText is identity
    const rawStripped = body;
    const expectedStart = sourceToPlainText(rawStripped, abcRawOffset);
    expect(parsed.startOffset).toBe(expectedStart);

    // endOffset = sourceToPlainText(raw, start + "abc".length)
    const expectedEnd = sourceToPlainText(rawStripped, abcRawOffset + 'abc'.length);
    expect(parsed.endOffset).toBe(expectedEnd);
    // Should be expectedStart + 3
    expect(parsed.endOffset).toBe(expectedStart + 3);
  });

  // ── Stdout JSON shape ────────────────────────────────────────────────────

  it('stdout JSON shape: has exactly the 4 anchor fields', async () => {
    const body = '# Doc\n\nSome content.\n';
    const thread = makeThread({ quote: 'Some content', startOffset: 7 });
    const mdPath = join(tmpDir, 'shape.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli([
      'update-comment-ref',
      mdPath,
      't-abc123',
      '--quote=Some content',
    ]);

    expect(code).toBe(0);

    const parsed = JSON.parse(stdout.trim());
    const keys = Object.keys(parsed).sort();
    expect(keys).toEqual(['endOffset', 'quote', 'startOffset', 'xpath'].sort());
  });

  // ── Byte-equivalence ─────────────────────────────────────────────────────

  it('byte-equivalence: CLI output matches stripCommentBlock(originalRaw)+serializeCommentBlock(parsedThreads)', async () => {
    const body = '# Cache Strategy\n\nWe use Redis for caching.\n';
    const thread = makeThread({ quote: 'Redis for caching', startOffset: 20 });
    const originalContent = body + commentBlock([thread]);
    const mdPath = join(tmpDir, 'byte-equiv.md');
    await writeFile(mdPath, originalContent);

    const { code } = await runCli([
      'update-comment-ref',
      mdPath,
      't-abc123',
      '--quote=We use Redis',
    ]);
    expect(code).toBe(0);

    // Read the file produced by CLI
    const cliOutput = await readFile(mdPath, 'utf8');

    // Parse the CLI-written file to get threads (with updated anchor)
    const parsedThreads = parseCommentBlock(cliOutput);

    // Reconstruct via the same server-PATCH functions
    const expectedContent =
      stripCommentBlock(originalContent) + serializeCommentBlock(parsedThreads);

    expect(cliOutput).toBe(expectedContent);
  });
});

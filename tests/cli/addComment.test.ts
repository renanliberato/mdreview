import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import { parseCommentBlock, stripCommentBlock, serializeCommentBlock } from '../../src/shared/commentBlock';
import { startCliHarness, type CliHarness } from './_harness';

// ---------------------------------------------------------------------------
// Harness setup
// ---------------------------------------------------------------------------

let harness: CliHarness;
let tmpDir: string;
const runCli = (args: string[], _cwd?: string, stdinText?: string) =>
  harness.runCli(args, undefined, stdinText);

beforeAll(async () => {
  harness = await startCliHarness('addcomment');
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

describe('add-comment command', () => {
  it('missing positionals → exit 1 (no file, no thread-id)', async () => {
    const { stderr, code } = await runCli(['add-comment']);
    expect(code).toBe(1);
    expect(stderr).toContain('usage');
  });

  it('missing --text → exit 1, stderr contains --text is required', async () => {
    const body = '# Hello\n\nSome text.\n';
    const thread = makeThread({ quote: 'Some text', startOffset: 9 });
    const mdPath = join(tmpDir, 'doc.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stderr, code } = await runCli(['add-comment', mdPath, 't-abc123']);
    expect(code).toBe(1);
    expect(stderr).toContain('--text is required');
  });

  it('file not found → exit 2', async () => {
    const { stderr, code } = await runCli([
      'add-comment',
      'nonexistent-addcomment.md',
      't-abc123',
      '--text=Hello',
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('not_found');
  });

  it('unknown thread id → exit 3, stderr contains thread <id> not found', async () => {
    const body = '# Hello\n\nSome text.\n';
    const thread = makeThread({ quote: 'Some text', startOffset: 9 });
    const mdPath = join(tmpDir, 'doc.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stderr, code } = await runCli([
      'add-comment',
      mdPath,
      't-unknown',
      '--text=Hello',
    ]);
    expect(code).toBe(3);
    expect(stderr).toContain('thread t-unknown not found');
  });

  it('empty --text="" → exit 1, stderr contains --text must not be empty', async () => {
    const body = '# Hello\n\nSome text.\n';
    const thread = makeThread({ quote: 'Some text', startOffset: 9 });
    const mdPath = join(tmpDir, 'doc.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stderr, code } = await runCli([
      'add-comment',
      mdPath,
      't-abc123',
      '--text=',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain('--text must not be empty');
  });

  it('bad --type=foo → exit 1, stderr contains --type must be', async () => {
    const body = '# Hello\n\nSome text.\n';
    const thread = makeThread({ quote: 'Some text', startOffset: 9 });
    const mdPath = join(tmpDir, 'doc.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stderr, code } = await runCli([
      'add-comment',
      mdPath,
      't-abc123',
      '--text=Hello',
      '--type=foo',
    ]);
    expect(code).toBe(1);
    expect(stderr).toContain("--type must be 'human' or 'llm'");
  });

  it('happy path with defaults: exit 0, stdout is comment id, file has 2 comments', async () => {
    const body = '# Hello\n\nSome text here.\n';
    const originalThread = makeThread({ quote: 'Some text here', startOffset: 9 });
    const mdPath = join(tmpDir, 'doc.md');
    await writeFile(mdPath, body + commentBlock([originalThread]));

    const { stdout, code } = await runCli([
      'add-comment',
      mdPath,
      't-abc123',
      '--text=My reply',
    ]);

    expect(code).toBe(0);
    // stdout should be a single line matching c-<uuid>
    expect(stdout).toMatch(/^c-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n$/);

    // File should now have 2 comments in the thread
    const updatedRaw = await readFile(mdPath, 'utf8');
    const threads = parseCommentBlock(updatedRaw);
    expect(threads).toHaveLength(1);
    expect(threads[0].comments).toHaveLength(2);

    // Check defaults on new comment
    const newComment = threads[0].comments[1];
    const commentId = stdout.trim();
    expect(newComment.id).toBe(commentId);
    expect(newComment.author).toBe('claude');
    expect(newComment.authorType).toBe('llm');
    expect(newComment.text).toBe('My reply');

    // Anchor should be inherited from thread.comments[0].anchor
    const originalAnchor = (originalThread as any).comments[0].anchor;
    expect(newComment.anchor).toEqual(originalAnchor);

    // Comment block at EOF should match the block regex
    expect(updatedRaw).toMatch(/\n\n<!-- mdreview-comments:[\s\S]*?-->\s*$/);
  });

  it('custom --author=alice --type=human --text="Manual comment": new comment has those fields', async () => {
    const body = '# Hello\n\nSome text here.\n';
    const thread = makeThread({ quote: 'Some text here', startOffset: 9 });
    const mdPath = join(tmpDir, 'custom.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stdout, code } = await runCli([
      'add-comment',
      mdPath,
      't-abc123',
      '--text=Manual comment',
      '--author=alice',
      '--type=human',
    ]);

    expect(code).toBe(0);

    const updatedRaw = await readFile(mdPath, 'utf8');
    const threads = parseCommentBlock(updatedRaw);
    const newComment = threads[0].comments[1];

    expect(newComment.author).toBe('alice');
    expect(newComment.authorType).toBe('human');
    expect(newComment.text).toBe('Manual comment');
    expect(newComment.id).toBe(stdout.trim());
  });

  it('byte-equivalence vs server PATCH: CLI output matches stripCommentBlock(raw)+serializeCommentBlock(threads)', async () => {
    const body = '# Cache Strategy\n\nWe use Redis for caching.\n';
    const originalThread = makeThread({ quote: 'Redis for caching', startOffset: 20 });
    const originalContent = body + commentBlock([originalThread]);
    const mdPath = join(tmpDir, 'byte-equiv.md');
    await writeFile(mdPath, originalContent);

    // Run CLI
    const { stdout, code } = await runCli([
      'add-comment',
      mdPath,
      't-abc123',
      '--text=Byte-equiv test',
    ]);
    expect(code).toBe(0);

    // Read the file produced by CLI
    const cliOutput = await readFile(mdPath, 'utf8');

    // Parse the CLI-written file to get the threads (with the new comment in place)
    const parsedThreads = parseCommentBlock(cliOutput);

    // Reconstruct "expected" content using the same functions the server PATCH uses:
    //   stripped original + serializeCommentBlock(parsedThreads)
    // Both CLI and this reconstruction use stripCommentBlock(originalContent) as the base.
    const expectedContent = stripCommentBlock(originalContent) + serializeCommentBlock(parsedThreads);

    // They must be byte-identical
    expect(cliOutput).toBe(expectedContent);
  });

  it('--text=- reads from stdin: comment has the piped text', async () => {
    const body = '# Hello\n\nSome text.\n';
    const thread = makeThread({ quote: 'Some text', startOffset: 9 });
    const mdPath = join(tmpDir, 'stdin.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const stdinContent = 'Hello from stdin\n';
    const { stdout, code } = await runCli(
      ['add-comment', mdPath, 't-abc123', '--text=-'],
      undefined,
      stdinContent,
    );

    expect(code).toBe(0);

    const updatedRaw = await readFile(mdPath, 'utf8');
    const threads = parseCommentBlock(updatedRaw);
    const newComment = threads[0].comments[1];

    expect(newComment.id).toBe(stdout.trim());
    // stdin content is stored verbatim (including the trailing newline)
    expect(newComment.text).toBe(stdinContent);
  });

  it('--text=- with empty stdin → exit 1, stderr contains stdin is empty', async () => {
    const body = '# Hello\n\nSome text.\n';
    const thread = makeThread({ quote: 'Some text', startOffset: 9 });
    const mdPath = join(tmpDir, 'empty-stdin.md');
    await writeFile(mdPath, body + commentBlock([thread]));

    const { stderr, code } = await runCli(
      ['add-comment', mdPath, 't-abc123', '--text=-'],
      undefined,
      '', // empty stdin
    );

    expect(code).toBe(1);
    expect(stderr).toContain('stdin is empty');
  });
});

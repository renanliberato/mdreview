import { describe, it, expect } from 'bun:test';
import { renderMarkdown } from '../../src/client/lib/renderer';

describe('renderMarkdown — offset annotations', () => {
  it('annotates a simple paragraph with correct offsets', () => {
    const html = renderMarkdown('Hello world');
    // "Hello world" = 11 chars; the <p> should span [0, 11)
    expect(html).toContain('data-offset-start="0"');
    expect(html).toContain('data-offset-end="11"');
  });

  it('annotates h1 and p in a two-block document', () => {
    // "Title" = 5 chars at offset 0; "Paragraph" = 9 chars
    // Remark strips the heading text (no leading # in plain text) so the
    // h1 text node value is "Title" (offsets 0–5).
    const html = renderMarkdown('# Title\n\nParagraph');

    // h1 starts at offset 0
    expect(html).toMatch(/data-offset-start="0"/);

    // Both elements must have data-offset attrs
    const starts = [...html.matchAll(/data-offset-start="(\d+)"/g)].map((m) =>
      Number(m[1])
    );
    const ends = [...html.matchAll(/data-offset-end="(\d+)"/g)].map((m) =>
      Number(m[1])
    );

    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(ends.length).toBeGreaterThanOrEqual(2);

    // h1 must start at 0
    expect(starts).toContain(0);

    // The <p> offset start must be > 0 (comes after the heading text)
    const pStart = starts.find((s) => s > 0);
    expect(pStart).toBeDefined();
    expect(pStart).toBeGreaterThan(0);
  });

  it('strips the comment block before rendering', () => {
    const raw =
      '# Doc\n\nSome content.\n\n<!-- mdreview-comments: {"version":"1","threads":[]} -->';
    const html = renderMarkdown(raw);

    // Comment block must NOT appear in the output
    expect(html).not.toContain('mdreview-comments');

    // But the real content must be rendered
    expect(html).toContain('Doc');
    expect(html).toContain('Some content.');

    // And offset attrs must be present
    expect(html).toContain('data-offset-start');
    expect(html).toContain('data-offset-end');
  });

  it('produces correct offset for "Hello world" — sanity check', () => {
    const html = renderMarkdown('Hello world');
    console.log('[sanity] Hello world output:', html);
    expect(html).toContain('data-offset-start="0"');
    expect(html).toContain('data-offset-end="11"');
  });
});

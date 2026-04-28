import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import { rehypeAnnotateOffsets } from './rehypeAnnotateOffsets';
import { rehypeAnnotateLines } from './rehypeAnnotateLines';
import { rehypeSlugHeadings } from './rehypeSlugHeadings';
import { stripCommentBlock } from '../../shared/commentBlock';

/**
 * Render a raw markdown string to an HTML string.
 *
 * - Strips the mdreview comment block before rendering so it never appears in
 *   the HTML output.
 * - Annotates every element that contains text with `data-offset-start` and
 *   `data-offset-end` attributes (cumulative plain-text character positions).
 * - Never throws; markdown is permissive and rehype-stringify handles all edge
 *   cases.
 */
export function renderMarkdown(raw: string): string {
  const stripped = stripCommentBlock(raw);
  const result = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeAnnotateOffsets)
    .use(rehypeAnnotateLines)
    .use(rehypeSlugHeadings)
    .use(rehypeStringify)
    .processSync(stripped);
  return String(result);
}

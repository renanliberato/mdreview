import { visit } from 'unist-util-visit';
import type { Root, Element, Text } from 'hast';
import type { Plugin } from 'unified';

/**
 * A rehype plugin that annotates every element that directly contains text
 * with `data-offset-start` and `data-offset-end` attributes.
 *
 * Offsets are cumulative plain-text character positions across the whole
 * document (i.e. they match `extractPlainText(container)` indices in the DOM).
 *
 * Algorithm: walk all `text` nodes in document order. For each text node:
 *   - start = cursor
 *   - cursor += node.value.length
 *   - end = cursor
 *   - On the parent element, set data-offset-start to start (if not already set)
 *   - Always update data-offset-end to end
 *
 * This ensures every element that contains text gets the full span of all its
 * text content as [data-offset-start, data-offset-end).
 */
export const rehypeAnnotateOffsets: Plugin<[], Root> = () => {
  return (tree: Root) => {
    let cursor = 0;

    visit(tree, 'text', (node: Text, _index, parent) => {
      const start = cursor;
      cursor += node.value.length;
      const end = cursor;

      if (!parent || parent.type !== 'element') return;

      const el = parent as Element;

      // Set start only on first text encounter within this element
      if (el.properties['data-offset-start'] === undefined) {
        el.properties['data-offset-start'] = start;
      }
      // Always push end forward so the element covers all its text children
      el.properties['data-offset-end'] = end;
    });
  };
};

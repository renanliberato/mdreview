import { visit } from 'unist-util-visit';
import type { Root, Element } from 'hast';
import type { Plugin } from 'unified';

/**
 * A rehype plugin that copies remark's `position.start.line` onto block-level
 * elements as `data-source-line` (1-based).
 *
 * remark-rehype preserves the `position` node property when it converts mdast
 * nodes to hast nodes, so we can read it here.
 */
export const rehypeAnnotateLines: Plugin<[], Root> = () => {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      const pos = (node as unknown as { position?: { start?: { line?: number } } }).position;
      if (pos?.start?.line !== undefined) {
        node.properties['data-source-line'] = pos.start.line;
      }
    });
  };
};

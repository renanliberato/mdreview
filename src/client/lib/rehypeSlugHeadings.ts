import { visit } from 'unist-util-visit';
import type { Root, Element } from 'hast';
import type { Plugin } from 'unified';

function extractText(node: Element): string {
  let text = '';
  for (const child of node.children) {
    if (child.type === 'text') text += child.value;
    else if (child.type === 'element') text += extractText(child as Element);
  }
  return text;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-');
}

export const rehypeSlugHeadings: Plugin<[], Root> = () => {
  return (tree: Root) => {
    const counts = new Map<string, number>();
    visit(tree, 'element', (node: Element) => {
      if (!/^h[1-6]$/.test(node.tagName)) return;
      const text = extractText(node);
      const slug = slugify(text);
      const count = counts.get(slug) ?? 0;
      counts.set(slug, count + 1);
      node.properties ??= {};
      node.properties.id = count === 0 ? slug : `${slug}-${count}`;
    });
  };
};

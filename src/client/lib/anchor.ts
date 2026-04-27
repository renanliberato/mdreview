import type { SelectionAnchor } from '../../shared/types'

/**
 * Attempts to re-anchor a stored `SelectionAnchor` back onto the current DOM
 * using three progressively looser strategies:
 *
 *  1. Plain-text offset match near the original offset (within ±50 chars)
 *  2. Plain-text match anywhere in the container
 *  3. XPath fallback — resolve the XPath and select the whole element
 *
 * Returns null when all strategies fail (orphaned anchor).
 */
export function findAnchorInDom(
  anchor: SelectionAnchor,
  container: Element,
): Range | null {
  const plainText = extractPlainText(container)

  // Strategy 1: offset-proximity match
  const searchStart = Math.max(0, anchor.startOffset - 20)
  const idx1 = plainText.indexOf(anchor.quote, searchStart)
  if (idx1 !== -1 && Math.abs(idx1 - anchor.startOffset) < 50) {
    return plainTextOffsetToRange(container, idx1, idx1 + anchor.quote.length)
  }

  // Strategy 2: anywhere in the document
  const idx2 = plainText.indexOf(anchor.quote)
  if (idx2 !== -1) {
    return plainTextOffsetToRange(container, idx2, idx2 + anchor.quote.length)
  }

  // Strategy 3: XPath fallback
  // `document.evaluate` may be undefined in some environments (e.g. happy-dom).
  if (typeof document.evaluate === 'function' && anchor.xpath) {
    try {
      const result = document.evaluate(
        anchor.xpath,
        document,
        null,
        XPathResult.FIRST_ORDERED_NODE_TYPE,
        null,
      )
      const el = result.singleNodeValue as Element | null
      if (el) {
        const range = document.createRange()
        range.selectNodeContents(el)
        return range
      }
    } catch {
      // Malformed XPath — fall through to null
    }
  }

  return null
}

/**
 * Removes the temporary pending mark (data-thread-id="__pending__") by
 * unwrapping it back to plain text nodes.
 */
export function unwrapPendingMark(container: Element | null): void {
  if (!container) return;
  container.querySelectorAll('mark[data-thread-id="__pending__"]').forEach((mark) => {
    const parent = mark.parentNode;
    if (parent) {
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
    }
  });
}

/**
 * Wraps the text covered by `range` in one or more `<mark>` elements tagged
 * with `threadId`. Each text node intersecting the range is split at the
 * range boundaries and the middle slice is wrapped in its own `<mark>` —
 * block-level structure (lists, paragraphs, code) is never crossed.
 *
 * Returns the first `<mark>` created (or null if the range had no text).
 */
export function wrapAnchor(range: Range, threadId: string): HTMLElement | null {
  const root = range.commonAncestorContainer
  const rootElement: Node =
    root.nodeType === Node.ELEMENT_NODE ? root : root.parentNode!
  if (!rootElement) return null

  // Collect all text nodes intersecting the range BEFORE mutating the DOM.
  const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let n: Node | null = walker.nextNode()
  while (n !== null) {
    if (range.intersectsNode(n)) textNodes.push(n as Text)
    n = walker.nextNode()
  }

  const marks: HTMLElement[] = []
  for (const tn of textNodes) {
    const startInThis = tn === range.startContainer ? range.startOffset : 0
    const endInThis =
      tn === range.endContainer ? range.endOffset : (tn.nodeValue ?? '').length
    if (endInThis <= startInThis) continue

    // Split off the leading and trailing portions; the middle is what we wrap.
    let target = tn
    if (startInThis > 0) target = target.splitText(startInThis)
    const middleEnd = endInThis - startInThis
    if (middleEnd < (target.nodeValue ?? '').length) target.splitText(middleEnd)

    const mark = document.createElement('mark')
    mark.dataset.threadId = threadId
    mark.classList.add('mdreview-highlight')
    target.parentNode!.insertBefore(mark, target)
    mark.appendChild(target)
    marks.push(mark)
  }

  return marks[0] ?? null
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** Concatenates all text-node values inside `container`. */
function extractPlainText(container: Element): string {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let text = ''
  let node: Node | null = walker.nextNode()
  while (node !== null) {
    text += node.nodeValue ?? ''
    node = walker.nextNode()
  }
  return text
}

/**
 * Converts a plain-text [start, end) character range inside `container` to a
 * DOM Range object.
 *
 * Returns null if the offsets are out of bounds.
 */
function plainTextOffsetToRange(
  container: Element,
  start: number,
  end: number,
): Range | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let cursor = 0
  let startNode: Node | null = null
  let startNodeOffset = 0
  let endNode: Node | null = null
  let endNodeOffset = 0

  let node: Node | null = walker.nextNode()
  while (node !== null) {
    const nodeLen = (node.nodeValue ?? '').length
    const nodeEnd = cursor + nodeLen

    if (startNode === null && start >= cursor && start <= nodeEnd) {
      startNode = node
      startNodeOffset = start - cursor
    }
    if (endNode === null && end >= cursor && end <= nodeEnd) {
      endNode = node
      endNodeOffset = end - cursor
      break
    }

    cursor += nodeLen
    node = walker.nextNode()
  }

  if (!startNode || !endNode) return null

  const range = document.createRange()
  range.setStart(startNode, startNodeOffset)
  range.setEnd(endNode, endNodeOffset)
  return range
}

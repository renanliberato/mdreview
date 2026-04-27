import type { SelectionAnchor } from '../../shared/types'

const MIN_WORDS = 5;
const MIN_CHARS = 20;

/**
 * Captures the current text selection within `container` and converts it to a
 * plain-text offset-based anchor.
 *
 * If the selected text is fewer than 5 words or 20 chars, the anchor is
 * expanded outward along the same line to reach that threshold.
 *
 * Returns null when:
 *  - there is no selection or the selection is collapsed
 *  - the selection falls outside `container`
 *  - the start node could not be found in the TreeWalker traversal
 */
export function captureSelection(container: Element): SelectionAnchor | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null

  const range = sel.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer)) return null

  // Build the full plain text while finding offsets
  let plainText = ''
  let plainTextCursor = 0
  let startOffset = -1
  let endOffset = -1

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  let node: Node | null = walker.nextNode()
  while (node !== null) {
    const val = node.nodeValue ?? ''
    const nodeLen = val.length

    if (node === range.startContainer) {
      startOffset = plainTextCursor + range.startOffset
    }
    if (node === range.endContainer) {
      endOffset = plainTextCursor + range.endOffset
      // Continue walking to build full plainText
    }

    plainText += val
    plainTextCursor += nodeLen
    node = walker.nextNode()
  }

  if (startOffset === -1) return null

  let quote = sel.toString().trim()
  const nlIdx = quote.indexOf('\n')
  if (nlIdx !== -1) {
    quote = quote.slice(0, nlIdx).trim()
    endOffset = startOffset + quote.length
  }

  // Expand short selections outward within the same line
  const wordCount = quote.trim().split(/\s+/).filter(Boolean).length
  if (wordCount < MIN_WORDS || quote.length < MIN_CHARS) {
    const expanded = expandWithinLine(plainText, startOffset, endOffset)
    startOffset = expanded.startOffset
    endOffset = expanded.endOffset
    quote = expanded.quote
  }

  return {
    quote,
    startOffset,
    endOffset,
    xpath: getXPath(range.startContainer.parentElement),
  }
}

/**
 * Expands [startOffset, endOffset) outward within the same line until
 * the slice has at least MIN_WORDS words or MIN_CHARS characters.
 * Never crosses a newline boundary.
 */
function expandWithinLine(
  plainText: string,
  startOffset: number,
  endOffset: number,
): { startOffset: number; endOffset: number; quote: string } {
  // Find the line boundaries around the selection
  const lineStart = plainText.lastIndexOf('\n', startOffset - 1) + 1
  const nlAfter = plainText.indexOf('\n', endOffset)
  const lineEnd = nlAfter === -1 ? plainText.length : nlAfter

  let lo = startOffset
  let hi = endOffset

  while (true) {
    const slice = plainText.slice(lo, hi).trim()
    const words = slice.split(/\s+/).filter(Boolean).length
    if (words >= MIN_WORDS && slice.length >= MIN_CHARS) break
    if (lo <= lineStart && hi >= lineEnd) break

    // Alternate: expand right, then left
    const rightMatch = hi < lineEnd ? plainText.slice(hi, lineEnd).match(/^\s*\S+/) : null
    const leftMatch  = lo > lineStart ? plainText.slice(lineStart, lo).match(/\S+\s*$/) : null

    if (rightMatch) {
      hi += rightMatch[0].length
    } else if (leftMatch) {
      lo -= leftMatch[0].length
    } else {
      break
    }
  }

  // Trim leading/trailing whitespace from the final quote
  const raw = plainText.slice(lo, hi)
  const leadingWs = raw.length - raw.trimStart().length
  const trailingWs = raw.length - raw.trimEnd().length
  lo += leadingWs
  hi -= trailingWs

  return { startOffset: lo, endOffset: hi, quote: plainText.slice(lo, hi) }
}

/**
 * Builds an XPath string for `el` by walking up the DOM tree and recording
 * each element's tag name and 1-based sibling index.
 *
 * Returns '' if `el` is null.
 */
export function getXPath(el: Element | null): string {
  if (!el) return ''
  const parts: string[] = []
  let current: Element | null = el
  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tag = current.tagName.toLowerCase()
    const parent = current.parentElement
    let index = 1
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === current!.tagName,
      )
      index = siblings.indexOf(current) + 1
    }
    parts.unshift(`/${tag}[${index}]`)
    current = parent
  }
  return parts.join('')
}

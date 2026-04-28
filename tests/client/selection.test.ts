import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { captureSelection, getXPath } from '../../src/client/lib/selection'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a fresh container <div> in document.body and returns it. */
function makeContainer(html: string): HTMLElement {
  const div = document.createElement('div')
  div.innerHTML = html
  document.body.appendChild(div)
  return div
}

/** Removes `el` from the DOM and clears the selection. */
function cleanup(el: Element): void {
  el.parentElement?.removeChild(el)
  window.getSelection()?.removeAllRanges()
}

/**
 * Creates a Range spanning `[startOffset, endOffset)` within `textNode`
 * and adds it to the window selection.
 */
function selectInNode(
  textNode: Node,
  startOffset: number,
  endOffset: number,
): Range {
  const range = document.createRange()
  range.setStart(textNode, startOffset)
  range.setEnd(textNode, endOffset)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
  return range
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('captureSelection', () => {
  afterEach(() => {
    // clear selection and body between tests
    window.getSelection()?.removeAllRanges()
    document.body.innerHTML = ''
  })

  it('returns null when there is no selection (no ranges)', () => {
    const container = makeContainer('<p>Hello world</p>')
    window.getSelection()?.removeAllRanges()
    expect(captureSelection(container)).toBeNull()
  })

  it('returns null when the selection is collapsed (cursor, not a range)', () => {
    const container = makeContainer('<p>Hello world</p>')
    const p = container.querySelector('p')!
    const textNode = p.firstChild!
    // Set a collapsed (zero-length) selection
    const range = document.createRange()
    range.setStart(textNode, 2)
    range.setEnd(textNode, 2)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    expect(captureSelection(container)).toBeNull()
    cleanup(container)
  })

  it('returns null when the selection is outside the container', () => {
    const container = makeContainer('<p>Inside</p>')
    const outside = makeContainer('<p>Outside</p>')
    const textNode = outside.querySelector('p')!.firstChild!
    selectInNode(textNode, 0, 7)
    // Pass the inner container — selection is in `outside`
    expect(captureSelection(container)).toBeNull()
    cleanup(container)
    cleanup(outside)
  })

  it('captures a single-node selection: "The quick brown fox jumps" in long paragraph', () => {
    const container = makeContainer('<p>The quick brown fox jumps over the lazy dog</p>')
    const textNode = container.querySelector('p')!.firstChild!
    selectInNode(textNode, 0, 25)
    const anchor = captureSelection(container)
    expect(anchor).not.toBeNull()
    expect(anchor!.quote).toBe('The quick brown fox jumps')
    expect(anchor!.startOffset).toBe(0)
    expect(anchor!.endOffset).toBe(25)
    cleanup(container)
  })

  it('captures a mid-string selection: "jumps over the lazy dog" in long paragraph', () => {
    const container = makeContainer('<p>The quick brown fox jumps over the lazy dog</p>')
    const textNode = container.querySelector('p')!.firstChild!
    selectInNode(textNode, 20, 43)
    const anchor = captureSelection(container)
    expect(anchor).not.toBeNull()
    expect(anchor!.quote).toBe('jumps over the lazy dog')
    expect(anchor!.startOffset).toBe(20)
    expect(anchor!.endOffset).toBe(43)
    cleanup(container)
  })

  it('clips quote to the first newline for multi-line selections', () => {
    // The selection spans the whole text node which contains a newline
    const container = makeContainer('<p>line1\nline2</p>')
    const textNode = container.querySelector('p')!.firstChild!
    // Select all of "line1\nline2"
    selectInNode(textNode, 0, (textNode.nodeValue ?? '').length)
    const anchor = captureSelection(container)
    expect(anchor).not.toBeNull()
    // Quote must be clipped to first line
    expect(anchor!.quote).toBe('line1')
    // endOffset must be adjusted to startOffset + quote.length
    expect(anchor!.endOffset).toBe(anchor!.startOffset + anchor!.quote.length)
    cleanup(container)
  })

  it('includes an xpath field pointing to the parent element', () => {
    const container = makeContainer('<p>Hello world</p>')
    const textNode = container.querySelector('p')!.firstChild!
    selectInNode(textNode, 0, 5)
    const anchor = captureSelection(container)
    expect(anchor).not.toBeNull()
    expect(typeof anchor!.xpath).toBe('string')
    expect(anchor!.xpath.length).toBeGreaterThan(0)
    expect(anchor!.xpath).toContain('/p[')
    cleanup(container)
  })
})

// ---------------------------------------------------------------------------
// getXPath
// ---------------------------------------------------------------------------

describe('getXPath', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns empty string for null', () => {
    expect(getXPath(null)).toBe('')
  })

  it('returns a non-empty path for a known element', () => {
    const container = makeContainer('<div><p id="target">text</p></div>')
    const p = container.querySelector('p')!
    const xpath = getXPath(p)
    expect(xpath.length).toBeGreaterThan(0)
    expect(xpath).toContain('/p[1]')
    cleanup(container)
  })

  it('produces correct index for second sibling of same type', () => {
    const container = makeContainer('<div><p>first</p><p id="second">second</p></div>')
    const ps = container.querySelectorAll('p')
    const xpath1 = getXPath(ps[0])
    const xpath2 = getXPath(ps[1])
    expect(xpath1).toContain('/p[1]')
    expect(xpath2).toContain('/p[2]')
    cleanup(container)
  })

  it('returns a stable path when called twice for the same element', () => {
    const container = makeContainer('<p>Hello</p>')
    const p = container.querySelector('p')!
    expect(getXPath(p)).toBe(getXPath(p))
    cleanup(container)
  })
})

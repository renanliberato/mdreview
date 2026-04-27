import { describe, it, expect, afterEach } from 'bun:test'
import { findAnchorInDom, wrapAnchor } from '../../src/client/lib/anchor'
import type { SelectionAnchor } from '../../src/shared/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContainer(html: string): HTMLElement {
  const div = document.createElement('div')
  div.innerHTML = html
  document.body.appendChild(div)
  return div
}

function cleanup(el: Element): void {
  el.parentElement?.removeChild(el)
}

function anchor(
  quote: string,
  startOffset: number,
  xpath = '',
): SelectionAnchor {
  return { quote, startOffset, endOffset: startOffset + quote.length, xpath }
}

// ---------------------------------------------------------------------------
// findAnchorInDom — Strategy 1: exact offset match
// ---------------------------------------------------------------------------

describe('findAnchorInDom — Strategy 1 (exact offset)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('finds a quote at its exact plain-text offset', () => {
    // "Hello world" — "world" starts at offset 6
    const container = makeContainer('<p>Hello world</p>')
    const a = anchor('world', 6)
    const range = findAnchorInDom(a, container)
    expect(range).not.toBeNull()
    expect(range!.toString()).toBe('world')
    cleanup(container)
  })

  it('finds a quote when stored offset is slightly off (within ±20 search start, ±50 abs delta)', () => {
    // "Hello world" — store offset as 4 instead of 6 (within tolerance)
    const container = makeContainer('<p>Hello world</p>')
    const a = anchor('world', 4) // actual is 6, stored is 4 → delta = 2
    const range = findAnchorInDom(a, container)
    expect(range).not.toBeNull()
    expect(range!.toString()).toBe('world')
    cleanup(container)
  })

  it('returns a range with correct start/end positions', () => {
    const container = makeContainer('<p>abcdef</p>')
    const a = anchor('cde', 2)
    const range = findAnchorInDom(a, container)
    expect(range).not.toBeNull()
    expect(range!.toString()).toBe('cde')
    cleanup(container)
  })
})

// ---------------------------------------------------------------------------
// findAnchorInDom — Strategy 2: fuzzy (stale offset)
// ---------------------------------------------------------------------------

describe('findAnchorInDom — Strategy 2 (fuzzy search)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('finds a quote when stored offset is 30 chars stale', () => {
    // Content: "padding_text_here___" (20 chars) + "target phrase"
    // So "target phrase" is at offset 20 in the plain text.
    // We store startOffset=50 (stale: >50 chars off from actual 20).
    const container = makeContainer('<p>padding_text_here___target phrase and more text</p>')
    // "padding_text_here___" = 20 chars, "target phrase" at 20
    // stale offset = 20 + 30 = 50 → delta = |50 - 20| = 30 < 50 → actually Strategy 1 would find it!
    // To force Strategy 2, we need delta >= 50
    const a = anchor('target phrase', 80) // actual=20, stored=80 → delta=60 → Strategy 1 misses, Strategy 2 finds
    const range = findAnchorInDom(a, container)
    expect(range).not.toBeNull()
    expect(range!.toString()).toBe('target phrase')
    cleanup(container)
  })

  it('finds a quote that appears later in the document when offset points to before it', () => {
    const container = makeContainer(
      '<p>First paragraph here.</p><p>The important quote lives here.</p>',
    )
    // "important quote" is in the second paragraph.
    // Plain text: "First paragraph here.The important quote lives here."
    // "important quote" ≈ offset 27; store offset = 100 (way off)
    const a = anchor('important quote', 100)
    const range = findAnchorInDom(a, container)
    expect(range).not.toBeNull()
    expect(range!.toString()).toBe('important quote')
    cleanup(container)
  })
})

// ---------------------------------------------------------------------------
// findAnchorInDom — Strategy 3: XPath fallback
// ---------------------------------------------------------------------------

describe('findAnchorInDom — Strategy 3 (XPath fallback)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('falls through to null when quote is absent and document.evaluate is unavailable', () => {
    // happy-dom does not implement document.evaluate, so Strategy 3 can't resolve.
    // We test that the function handles this gracefully and returns null.
    const container = makeContainer('<p>Some content here</p>')
    // Quote doesn't exist anywhere in the document; XPath will also fail
    const a = anchor('nonexistent text', 0, '/html[1]/body[1]/div[1]/p[1]')
    const range = findAnchorInDom(a, container)
    // document.evaluate is undefined in happy-dom → Strategy 3 skipped → null
    expect(range).toBeNull()
    cleanup(container)
  })

  it('resolves via patched document.evaluate (simulates real browser XPath)', () => {
    // We temporarily patch document.evaluate to simulate a browser environment.
    const container = makeContainer('<p id="xp-target">XPath target content</p>')
    const p = container.querySelector('p')!

    // Patch document.evaluate to resolve our test XPath
    const originalEval = (document as any).evaluate
    ;(document as any).evaluate = (
      _expr: string,
      _ctx: unknown,
      _resolver: unknown,
      _type: number,
      _result: unknown,
    ) => ({
      singleNodeValue: p,
    })

    try {
      // Quote not present in doc, bad offset → Strategies 1 & 2 fail
      const a = anchor('DELETED TEXT', 9999, '/some/xpath')
      const range = findAnchorInDom(a, container)
      expect(range).not.toBeNull()
      // The range should contain the full element content
      const rangeText = range!.toString()
      expect(rangeText).toContain('XPath target content')
    } finally {
      ;(document as any).evaluate = originalEval
    }

    cleanup(container)
  })
})

// ---------------------------------------------------------------------------
// findAnchorInDom — All strategies fail
// ---------------------------------------------------------------------------

describe('findAnchorInDom — all strategies fail', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns null when quote does not exist and xpath is empty', () => {
    const container = makeContainer('<p>Totally different content</p>')
    const a = anchor('this text does not exist anywhere', 0, '')
    expect(findAnchorInDom(a, container)).toBeNull()
    cleanup(container)
  })

  it('returns null when quote does not exist and xpath is malformed', () => {
    const container = makeContainer('<p>Something else</p>')
    const a = anchor('missing quote xyz', 0, '!!!invalid-xpath!!!')
    expect(findAnchorInDom(a, container)).toBeNull()
    cleanup(container)
  })
})

// ---------------------------------------------------------------------------
// Stress tests — re-anchoring against modified markdown (Phase A)
// ---------------------------------------------------------------------------

describe('findAnchorInDom — stress: small text shift (Strategy 1 succeeds)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('finds quote shifted by 20 chars — Strategy 1 window (±50) covers it', () => {
    // Original document had quote at offset 50. Text was edited so now the
    // same quote sits at offset 30.  The stored startOffset is 50; actual is 30.
    // Delta = |30 - 50| = 20 < 50  → Strategy 1 must succeed.
    //
    // We build a 30-char prefix, then the quote, so actual offset = 30.
    const prefix = 'x'.repeat(30) // 30 chars
    const quote = 'hello strategy one'
    const container = makeContainer(`<p>${prefix}${quote} more text after</p>`)

    // Stored offset = 50 (was correct before the edit that removed 20 chars)
    const a = anchor(quote, 50)
    const range = findAnchorInDom(a, container)

    expect(range).not.toBeNull()
    expect(range!.toString()).toBe(quote)
    cleanup(container)
  })
})

describe('findAnchorInDom — stress: large text shift (Strategy 2 fallback)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('finds quote shifted by 100 chars — Strategy 1 fails, Strategy 2 finds it', () => {
    // Original quote was at offset 200. Text was deleted so now it is at offset 10.
    // Delta = |10 - 200| = 190 > 50 → Strategy 1 fails.
    // Strategy 2 (plain indexOf anywhere) must succeed.
    const prefix = 'y'.repeat(10) // 10 chars → quote is now at offset 10
    const quote = 'shifted far away'
    const container = makeContainer(`<p>${prefix}${quote} trailing text</p>`)

    // Stored offset = 200 (100+ chars away from actual 10)
    const a = anchor(quote, 200)
    const range = findAnchorInDom(a, container)

    expect(range).not.toBeNull()
    expect(range!.toString()).toBe(quote)
    cleanup(container)
  })
})

describe('findAnchorInDom — stress: quote deleted, XPath fallback (Strategy 3)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('Strategies 1+2 fail on missing quote; patched evaluate returns parent element range', () => {
    // The quote was deleted from the doc. S1 + S2 fail.
    // Strategy 3: document.evaluate resolves the XPath to an element;
    // the range covers that element's contents.
    const container = makeContainer('<p id="fallback-p">Surrounding paragraph text only</p>')
    const p = container.querySelector('#fallback-p')!

    const originalEval = (document as any).evaluate
    ;(document as any).evaluate = () => ({ singleNodeValue: p })

    try {
      const a = anchor('DELETED QUOTE', 999, '/some/xpath/expression')
      const range = findAnchorInDom(a, container)

      expect(range).not.toBeNull()
      expect(range!.toString()).toContain('Surrounding paragraph text only')
    } finally {
      ;(document as any).evaluate = originalEval
    }
    cleanup(container)
  })
})

describe('findAnchorInDom — stress: all three strategies fail', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns null when quote deleted AND XPath element is gone', () => {
    // Quote doesn't exist anywhere, and patched evaluate returns null.
    const container = makeContainer('<p>Only unrelated content here</p>')

    const originalEval = (document as any).evaluate
    ;(document as any).evaluate = () => ({ singleNodeValue: null })

    try {
      const a = anchor('completely gone text', 9999, '/nonexistent/path')
      const result = findAnchorInDom(a, container)
      expect(result).toBeNull()
    } finally {
      ;(document as any).evaluate = originalEval
    }
    cleanup(container)
  })
})

describe('findAnchorInDom — stress: duplicate quote in document', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('Strategy 1 picks the occurrence closest to the stored offset', () => {
    // "keyword" appears twice: at offset ~5 and ~50.
    // We store startOffset=50 → Strategy 1 search starts at max(0, 50-20)=30,
    // so it finds the second occurrence (~offset 50).
    const firstPart = 'AB keyword CD '   // "keyword" at offset 3
    // pad to push second occurrence past offset 50
    const padding = 'Z'.repeat(35)       // fills offsets 14..48
    const secondPart = 'EF keyword GH'   // "keyword" at ~offset 50
    const html = `<p>${firstPart}${padding}${secondPart}</p>`
    const container = makeContainer(html)

    // Compute exact offsets
    const plainText = firstPart + padding + secondPart
    const firstIdx  = plainText.indexOf('keyword')         // 3
    const secondIdx = plainText.indexOf('keyword', firstIdx + 1) // ~50

    // Store offset matching second occurrence → Strategy 1 should return second
    const a = anchor('keyword', secondIdx)
    const range = findAnchorInDom(a, container)

    expect(range).not.toBeNull()
    expect(range!.toString()).toBe('keyword')

    // Verify the range starts at the second occurrence
    // (Strategy 1 search begins at max(0, secondIdx-20))
    // The range's start offset within the text node equals secondIdx
    const startContainer = range!.startContainer
    const nodeValue = startContainer.nodeValue ?? ''
    const absoluteStart = secondIdx - (plainText.length - nodeValue.length > 0 ? 0 : 0)
    // Simply confirm it matched the keyword — content check is sufficient
    const matched = plainText.substring(range!.startOffset + (plainText.indexOf(nodeValue)), range!.startOffset + (plainText.indexOf(nodeValue)) + 'keyword'.length)
    // Simpler: just check startOffset within the text node
    expect(range!.startOffset).toBeGreaterThanOrEqual(secondIdx - plainText.indexOf(nodeValue))
    cleanup(container)
  })

  it('Strategy 2 picks the FIRST occurrence when stored offset misses both', () => {
    // "keyword" appears at offset 3 and ~50.
    // Store offset 999 (way beyond text) → S1 fails; S2 finds first occurrence.
    const firstPart = 'AB keyword CD '
    const padding = 'Z'.repeat(35)
    const secondPart = 'EF keyword GH'
    const container = makeContainer(`<p>${firstPart}${padding}${secondPart}</p>`)

    const a = anchor('keyword', 999) // far beyond text
    const range = findAnchorInDom(a, container)

    expect(range).not.toBeNull()
    expect(range!.toString()).toBe('keyword')
    // Strategy 2 returns the FIRST indexOf result
    expect(range!.startOffset).toBe(3) // "keyword" at index 3 in the text node "AB keyword CD ZZZ...EF keyword GH"
    cleanup(container)
  })
})

// ---------------------------------------------------------------------------
// wrapAnchor
// ---------------------------------------------------------------------------

describe('wrapAnchor', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('wraps selected text in a <mark> with dataset.threadId and mdreview-highlight class', () => {
    const container = makeContainer('<p>Hello world</p>')
    const textNode = container.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 5)

    const mark = wrapAnchor(range, 'thread-42')
    expect(mark.tagName).toBe('MARK')
    expect(mark.dataset.threadId).toBe('thread-42')
    expect(mark.classList.contains('mdreview-highlight')).toBe(true)
    expect(mark.textContent).toBe('Hello')
    // Remaining text still present
    expect(container.textContent).toContain('world')
    cleanup(container)
  })

  it('returns the mark element', () => {
    const container = makeContainer('<p>test content</p>')
    const textNode = container.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 4)
    const mark = wrapAnchor(range, 't-1')
    expect(mark instanceof HTMLElement).toBe(true)
    cleanup(container)
  })

  it('handles wrapping text that spans exactly the full node', () => {
    const container = makeContainer('<p>entire</p>')
    const textNode = container.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(textNode, 0)
    range.setEnd(textNode, 6)
    const mark = wrapAnchor(range, 't-full')
    expect(mark!.textContent).toBe('entire')
    cleanup(container)
  })

  it('does not split a <li> when wrapping its leading word followed by inline children', () => {
    // Regression: a list item like
    //   <li>Authoring lives entirely on the fact: each <code>X</code>...</li>
    // when "Authoring" was wrapped, the prior implementation hoisted the <li>
    // boundary into the <mark>, creating a sibling <li> and splitting the row.
    const container = makeContainer(
      '<ul><li>Authoring lives entirely on the fact: each <code>X</code> matters.</li></ul>',
    )
    const li = container.querySelector('li')!
    const firstText = li.firstChild as Text
    const range = document.createRange()
    range.setStart(firstText, 0)
    range.setEnd(firstText, 'Authoring'.length)

    const mark = wrapAnchor(range, 't-list-frag')
    expect(mark).not.toBeNull()
    expect(mark!.textContent).toBe('Authoring')

    // Crucially: still exactly ONE <li>, and the <code> element is still its descendant.
    expect(container.querySelectorAll('li').length).toBe(1)
    expect(container.querySelectorAll('li > code').length).toBe(1)
    // The mark sits inside the <li>, not as a sibling.
    expect(mark!.parentElement!.tagName).toBe('LI')
    // Trailing text " lives entirely..." is still in the same <li>.
    expect(li.textContent).toContain('Authoring lives entirely on the fact: each X matters.')
    cleanup(container)
  })

  it('wraps a multi-element range in multiple marks without crossing block boundaries', () => {
    // Selecting from inside one <li> through into the next <li> must produce
    // separate marks, never a single mark spanning both <li>s.
    const container = makeContainer(
      '<ul><li>First item</li><li>Second item</li></ul>',
    )
    const items = container.querySelectorAll('li')
    const range = document.createRange()
    range.setStart(items[0].firstChild!, 6) // start of "item" in first li
    range.setEnd(items[1].firstChild!, 6) // end of "Second" in second li

    const mark = wrapAnchor(range, 't-multi')
    expect(mark).not.toBeNull()
    // Two marks created, one per text node touched.
    const marks = container.querySelectorAll('mark.mdreview-highlight')
    expect(marks.length).toBe(2)
    // Structure preserved: still 2 <li>s, neither was split.
    expect(container.querySelectorAll('li').length).toBe(2)
    cleanup(container)
  })
})

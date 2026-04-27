import { Window } from 'happy-dom'

const win = new Window() as unknown as Window & typeof globalThis

// Expose the happy-dom window globals so that src/client code that references
// `window`, `document`, `Node`, `NodeFilter`, etc. works in tests.
Object.assign(globalThis, {
  window: win,
  document: win.document,
  Node: (win as any).Node,
  NodeFilter: (win as any).NodeFilter,
  XPathResult: (win as any).XPathResult ?? {
    FIRST_ORDERED_NODE_TYPE: 9,
    ANY_TYPE: 0,
    ORDERED_NODE_ITERATOR_TYPE: 5,
  },
  Range: (win as any).Range,
  HTMLElement: (win as any).HTMLElement,
  Element: (win as any).Element,
  localStorage: (win as any).localStorage,
  navigator: (win as any).navigator,
})

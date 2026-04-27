import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import type { Thread, SelectionAnchor } from '../../src/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal SelectionAnchor for test purposes. */
function makeAnchor(quote = 'test quote'): SelectionAnchor {
  return { quote, startOffset: 0, endOffset: quote.length, xpath: '/html/body/p[1]' };
}

/**
 * Stub global.fetch for a single test.
 * Returns the mock so callers can inspect calls.
 */
function stubFetch(response: { ok: boolean; json?: () => Promise<unknown>; status?: number } | 'reject') {
  const calls: Array<[string, RequestInit | undefined]> = [];
  const originalFetch = globalThis.fetch;

  if (response === 'reject') {
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      calls.push([String(input), init]);
      throw new Error('Network error');
    }) as typeof fetch;
  } else {
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      calls.push([String(input), init]);
      return {
        ok: response.ok,
        status: response.status ?? (response.ok ? 200 : 500),
        json: response.json ?? (() => Promise.resolve({})),
      } as Response;
    }) as typeof fetch;
  }

  return {
    calls,
    restore: () => { globalThis.fetch = originalFetch; },
  };
}

// ---------------------------------------------------------------------------
// Fresh store per test — re-import the module each time to reset state
// ---------------------------------------------------------------------------

/**
 * Reset the store to a clean slate by directly manipulating its state.
 * We do this because Zustand singletons persist between tests in the same
 * module. We call useStore.setState() with the initial values.
 */
async function getStore() {
  // Dynamic import to pick up the module (already cached after first import)
  const { useStore } = await import('../../src/client/lib/store');
  return useStore;
}

// Reset the store state between tests
async function resetStore(overrides?: Record<string, unknown>) {
  const { useStore } = await import('../../src/client/lib/store');
  useStore.setState({
    threads: [],
    filePath: null,
    raw: '',
    mtime: 0,
    user: 'test-user',
    loading: false,
    error: null,
    ...overrides,
  });
  return useStore;
}

// ---------------------------------------------------------------------------
// Tests: addThread
// ---------------------------------------------------------------------------

describe('store — addThread (optimistic add)', () => {
  afterEach(async () => {
    await resetStore();
  });

  it('appends thread to local state and calls PATCH /api/file on success', async () => {
    const mock = stubFetch({ ok: true, json: () => Promise.resolve({}) });
    try {
      const store = await resetStore({ filePath: '/docs/test.md', user: 'alice' });
      const state = store.getState();

      const anchor = makeAnchor('Hello world');
      const result = await state.addThread(anchor, 'My first comment');

      // Should return the new thread
      expect(result).not.toBeNull();
      expect(result!.comments).toHaveLength(1);
      expect(result!.comments[0].text).toBe('My first comment');
      expect(result!.comments[0].author).toBe('alice');
      expect(result!.resolved).toBe(false);

      // Thread should be in the store
      const { threads } = store.getState();
      expect(threads).toHaveLength(1);
      expect(threads[0].id).toBe(result!.id);

      // PATCH should have been called
      const patchCalls = mock.calls.filter(([url]) => url === '/api/file');
      expect(patchCalls).toHaveLength(1);
      const [, init] = patchCalls[0];
      expect(init?.method).toBe('PATCH');
      const body = JSON.parse(init?.body as string);
      expect(body.path).toBe('/docs/test.md');
      expect(body.threads).toHaveLength(1);
    } finally {
      mock.restore();
    }
  });

  it('returns null when filePath is not set', async () => {
    const mock = stubFetch({ ok: true });
    try {
      const store = await resetStore({ filePath: null });
      const state = store.getState();
      const result = await state.addThread(makeAnchor(), 'Should not add');
      expect(result).toBeNull();
      expect(store.getState().threads).toHaveLength(0);
      expect(mock.calls).toHaveLength(0);
    } finally {
      mock.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: addThread rollback on failure
// ---------------------------------------------------------------------------

describe('store — addThread (rollback on failure)', () => {
  afterEach(async () => {
    await resetStore();
  });

  it('rolls back the thread and sets error when fetch rejects', async () => {
    const mock = stubFetch('reject');
    try {
      const store = await resetStore({ filePath: '/docs/test.md', user: 'alice' });
      const state = store.getState();

      const result = await state.addThread(makeAnchor('Some text'), 'Failing comment');

      // addThread returns null on failure
      expect(result).toBeNull();

      // Threads array should be empty (rolled back)
      expect(store.getState().threads).toHaveLength(0);

      // Error should be set
      expect(store.getState().error).not.toBeNull();
      expect(typeof store.getState().error).toBe('string');
    } finally {
      mock.restore();
    }
  });

  it('rolls back the thread and sets error when server returns non-OK', async () => {
    const mock = stubFetch({ ok: false, status: 500 });
    try {
      const store = await resetStore({ filePath: '/docs/test.md', user: 'bob' });
      const state = store.getState();

      const result = await state.addThread(makeAnchor('quote'), 'Another comment');

      expect(result).toBeNull();
      expect(store.getState().threads).toHaveLength(0);
      expect(store.getState().error).not.toBeNull();
    } finally {
      mock.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: addReply
// ---------------------------------------------------------------------------

describe('store — addReply', () => {
  afterEach(async () => {
    await resetStore();
  });

  it('appends reply to the correct thread and calls PATCH', async () => {
    const mock = stubFetch({ ok: true, json: () => Promise.resolve({}) });
    try {
      const anchor = makeAnchor('first anchor');
      const thread1: Thread = {
        id: 'thread-1',
        resolved: false,
        comments: [{
          id: 'c-1',
          threadId: 'thread-1',
          author: 'alice',
          authorType: 'human',
          createdAt: '2026-01-01T00:00:00Z',
          text: 'First comment',
          anchor,
        }],
      };
      const thread2: Thread = {
        id: 'thread-2',
        resolved: false,
        comments: [{
          id: 'c-2',
          threadId: 'thread-2',
          author: 'bob',
          authorType: 'human',
          createdAt: '2026-01-01T00:01:00Z',
          text: 'Second thread comment',
          anchor: makeAnchor('second anchor'),
        }],
      };

      const store = await resetStore({
        filePath: '/docs/test.md',
        user: 'carol',
        threads: [thread1, thread2],
      });
      const state = store.getState();

      const reply = await state.addReply('thread-2', 'Reply to second thread');

      // Reply returned correctly
      expect(reply).not.toBeNull();
      expect(reply!.threadId).toBe('thread-2');
      expect(reply!.author).toBe('carol');
      expect(reply!.text).toBe('Reply to second thread');

      // Second thread should have 2 comments
      const { threads } = store.getState();
      const t2 = threads.find(t => t.id === 'thread-2')!;
      expect(t2.comments).toHaveLength(2);

      // First thread unchanged
      const t1 = threads.find(t => t.id === 'thread-1')!;
      expect(t1.comments).toHaveLength(1);

      // PATCH was called
      const patchCalls = mock.calls.filter(([url, init]) => url === '/api/file' && (init as RequestInit)?.method === 'PATCH');
      expect(patchCalls).toHaveLength(1);
    } finally {
      mock.restore();
    }
  });

  it('uses the provided author parameter instead of store.user', async () => {
    const mock = stubFetch({ ok: true, json: () => Promise.resolve({}) });
    try {
      const anchor = makeAnchor('anchor text');
      const thread: Thread = {
        id: 'thread-llm',
        resolved: false,
        comments: [{
          id: 'c-0',
          threadId: 'thread-llm',
          author: 'human',
          authorType: 'human',
          createdAt: '2026-01-01T00:00:00Z',
          text: 'Human comment',
          anchor,
        }],
      };

      const store = await resetStore({
        filePath: '/docs/doc.md',
        user: 'human',
        threads: [thread],
      });
      const state = store.getState();

      const reply = await state.addReply('thread-llm', 'LLM response', 'llm', 'claude-sonnet-4-6');

      expect(reply).not.toBeNull();
      expect(reply!.author).toBe('claude-sonnet-4-6');
      expect(reply!.authorType).toBe('llm');
    } finally {
      mock.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: resolveThread
// ---------------------------------------------------------------------------

describe('store — resolveThread', () => {
  afterEach(async () => {
    await resetStore();
  });

  it('flips resolved to true and persists', async () => {
    const mock = stubFetch({ ok: true, json: () => Promise.resolve({}) });
    try {
      const anchor = makeAnchor('resolve me');
      const thread: Thread = {
        id: 'thread-resolve',
        resolved: false,
        comments: [{
          id: 'c-r',
          threadId: 'thread-resolve',
          author: 'alice',
          authorType: 'human',
          createdAt: '2026-01-01T00:00:00Z',
          text: 'To be resolved',
          anchor,
        }],
      };

      const store = await resetStore({
        filePath: '/docs/doc.md',
        user: 'alice',
        threads: [thread],
      });
      const state = store.getState();

      await state.resolveThread('thread-resolve', true);

      const { threads } = store.getState();
      expect(threads[0].resolved).toBe(true);

      // PATCH was called
      const patchCalls = mock.calls.filter(([url, init]) => url === '/api/file' && (init as RequestInit)?.method === 'PATCH');
      expect(patchCalls).toHaveLength(1);
      const body = JSON.parse((patchCalls[0][1] as RequestInit).body as string);
      expect(body.threads[0].resolved).toBe(true);
    } finally {
      mock.restore();
    }
  });

  it('flips resolved back to false', async () => {
    const mock = stubFetch({ ok: true, json: () => Promise.resolve({}) });
    try {
      const anchor = makeAnchor('unresolve me');
      const thread: Thread = {
        id: 'thread-unresolve',
        resolved: true,
        comments: [{
          id: 'c-u',
          threadId: 'thread-unresolve',
          author: 'bob',
          authorType: 'human',
          createdAt: '2026-01-01T00:00:00Z',
          text: 'Was resolved',
          anchor,
        }],
      };

      const store = await resetStore({
        filePath: '/docs/doc.md',
        threads: [thread],
      });
      const state = store.getState();

      await state.resolveThread('thread-unresolve', false);

      expect(store.getState().threads[0].resolved).toBe(false);
    } finally {
      mock.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: setThreads
// ---------------------------------------------------------------------------

describe('store — setThreads', () => {
  afterEach(async () => {
    await resetStore();
  });

  it('replaces threads and updates mtime directly', async () => {
    const store = await resetStore({ mtime: 100 });
    const state = store.getState();

    const newThreads: Thread[] = [
      {
        id: 'new-thread',
        resolved: false,
        comments: [{
          id: 'nc-1',
          threadId: 'new-thread',
          author: 'alice',
          authorType: 'human',
          createdAt: '2026-01-01T00:00:00Z',
          text: 'New comment',
          anchor: makeAnchor('new text'),
        }],
      },
    ];

    state.setThreads(newThreads, 200);

    expect(store.getState().threads).toEqual(newThreads);
    expect(store.getState().mtime).toBe(200);
  });

  it('replaces existing threads with empty array', async () => {
    const anchor = makeAnchor('existing');
    const store = await resetStore({
      threads: [{
        id: 't-existing',
        resolved: false,
        comments: [{
          id: 'c-e',
          threadId: 't-existing',
          author: 'user',
          authorType: 'human',
          createdAt: '2026-01-01T00:00:00Z',
          text: 'Existing',
          anchor,
        }],
      }],
      mtime: 50,
    });
    const state = store.getState();

    state.setThreads([], 99);

    expect(store.getState().threads).toHaveLength(0);
    expect(store.getState().mtime).toBe(99);
  });
});

// ---------------------------------------------------------------------------
// Tests: loadFile
// ---------------------------------------------------------------------------

describe('store — loadFile', () => {
  afterEach(async () => {
    await resetStore();
  });

  it('sets filePath, raw, threads, and mtime on success', async () => {
    const anchor = makeAnchor('remote text');
    const remoteThreads: Thread[] = [{
      id: 'remote-thread',
      resolved: false,
      comments: [{
        id: 'rc-1',
        threadId: 'remote-thread',
        author: 'remote-user',
        authorType: 'human',
        createdAt: '2026-01-01T00:00:00Z',
        text: 'Remote comment',
        anchor,
      }],
    }];

    const mock = stubFetch({
      ok: true,
      json: () => Promise.resolve({ raw: '# Hello\n\nWorld', threads: remoteThreads, mtime: 12345 }),
    });

    try {
      const store = await resetStore();
      const state = store.getState();

      await state.loadFile('/docs/hello.md');

      const updated = store.getState();
      expect(updated.filePath).toBe('/docs/hello.md');
      expect(updated.raw).toBe('# Hello\n\nWorld');
      expect(updated.threads).toEqual(remoteThreads);
      expect(updated.mtime).toBe(12345);
      expect(updated.loading).toBe(false);
      expect(updated.error).toBeNull();

      // GET was called with the correct path
      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0][0]).toBe('/api/file?path=%2Fdocs%2Fhello.md');
    } finally {
      mock.restore();
    }
  });

  it('sets loading=false and error on fetch failure', async () => {
    const mock = stubFetch('reject');
    try {
      const store = await resetStore();
      const state = store.getState();

      await state.loadFile('/docs/missing.md');

      const updated = store.getState();
      expect(updated.loading).toBe(false);
      expect(updated.error).not.toBeNull();
      expect(updated.filePath).toBeNull();
    } finally {
      mock.restore();
    }
  });

  it('sets error on non-OK response', async () => {
    const mock = stubFetch({ ok: false, status: 404, json: () => Promise.resolve({ error: 'not_found' }) });
    try {
      const store = await resetStore();
      const state = store.getState();

      await state.loadFile('/docs/missing.md');

      const updated = store.getState();
      expect(updated.loading).toBe(false);
      expect(updated.error).not.toBeNull();
    } finally {
      mock.restore();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: startPolling
// ---------------------------------------------------------------------------

describe('store — startPolling', () => {
  afterEach(async () => {
    await resetStore();
  });

  it('returns a stop function when filePath is set', async () => {
    // We only verify contract: startPolling returns a function
    const mock = stubFetch({ ok: true, json: () => Promise.resolve({ raw: '', threads: [], mtime: 0 }) });
    try {
      const store = await resetStore({ filePath: '/docs/doc.md', mtime: 0 });
      const state = store.getState();

      const stop = state.startPolling(50000); // large interval so it doesn't fire
      expect(typeof stop).toBe('function');
      stop(); // Should not throw
    } finally {
      mock.restore();
    }
  });

  it('returns a no-op stop function when filePath is null', async () => {
    const mock = stubFetch({ ok: true });
    try {
      const store = await resetStore({ filePath: null });
      const state = store.getState();

      const stop = state.startPolling(50000);
      expect(typeof stop).toBe('function');
      stop(); // Should not throw

      // No fetch calls should have been made
      expect(mock.calls).toHaveLength(0);
    } finally {
      mock.restore();
    }
  });

  it('calls setThreads when mtime changes during polling', async () => {
    // Use a short interval and await a tick to let the poll fire
    let callCount = 0;
    const updatedMtime = 999;
    const updatedThreads: Thread[] = [];

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      callCount += 1;
      return {
        ok: true,
        json: () => Promise.resolve({ raw: '', threads: updatedThreads, mtime: updatedMtime }),
      } as Response;
    }) as typeof fetch;

    try {
      const store = await resetStore({ filePath: '/docs/poll.md', mtime: 1 });
      const state = store.getState();

      const stop = state.startPolling(50); // 50ms interval
      // Wait long enough for at least one poll
      await new Promise(r => setTimeout(r, 200));
      stop();

      // mtime should have been updated
      expect(store.getState().mtime).toBe(updatedMtime);
      expect(callCount).toBeGreaterThanOrEqual(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does NOT call setThreads while isPersisting is true', async () => {
    // While a PATCH is in flight (isPersisting=true), a polling tick that
    // returns a different mtime must not clobber the optimistic state.
    let fetchCallCount = 0;
    const staleMtime = 500;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      fetchCallCount += 1;
      return {
        ok: true,
        json: () => Promise.resolve({ raw: '', threads: [], mtime: staleMtime }),
      } as Response;
    }) as typeof fetch;

    try {
      // Set isPersisting=true to simulate an in-flight PATCH; mtime=1
      const store = await resetStore({ filePath: '/docs/persist.md', mtime: 1, isPersisting: true });
      const state = store.getState();

      const stop = state.startPolling(50); // 50ms interval
      // Wait long enough for multiple potential poll ticks
      await new Promise(r => setTimeout(r, 200));
      stop();

      // mtime must remain unchanged even though poll returned staleMtime=500
      expect(store.getState().mtime).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// Tests: clearError
// ---------------------------------------------------------------------------

describe('store — clearError', () => {
  afterEach(async () => {
    await resetStore();
  });

  it('sets error to null', async () => {
    const store = await resetStore({ error: 'Failed to save comment. Please try again.' });
    const state = store.getState();

    expect(store.getState().error).not.toBeNull();
    state.clearError();
    expect(store.getState().error).toBeNull();
  });

  it('is a no-op when error is already null', async () => {
    const store = await resetStore({ error: null });
    const state = store.getState();

    state.clearError(); // should not throw
    expect(store.getState().error).toBeNull();
  });
});

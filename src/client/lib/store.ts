import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import type { Thread, Comment, SelectionAnchor } from '../../shared/types';
import { addRecentFile } from './share';

export interface DiffHunk {
  startLine: number;
  lineCount: number;
}

interface StoreState {
  threads: Thread[];
  filePath: string | null;
  raw: string;          // stripped raw markdown (server returns it pre-stripped)
  mtime: number;
  user: string;          // current user (from ?user= or localStorage)
  loading: boolean;
  error: string | null;
  isPersisting: boolean; // true while a PATCH request is in flight
  showResolved: boolean;
  showDiff: boolean;
  diffHunks: DiffHunk[];

  loadFile: (path: string) => Promise<void>;
  setUser: (user: string) => void;
  setShowResolved: (show: boolean) => void;
  setShowDiff: (show: boolean) => Promise<void>;
  addThread: (anchor: SelectionAnchor, text: string) => Promise<Thread | null>;
  addReply: (threadId: string, text: string, authorType?: 'human' | 'llm', author?: string) => Promise<Comment | null>;
  resolveThread: (threadId: string, resolved: boolean) => Promise<void>;
  setThreads: (threads: Thread[], mtime: number) => void;
  clearError: () => void;
  startPolling: (intervalMs?: number) => () => void; // returns stop fn
}

// ---------------------------------------------------------------------------
// Internal helper — persists current threads to the server via PATCH
// ---------------------------------------------------------------------------

async function persistToServer(filePath: string, threads: Thread[]): Promise<void> {
  const res = await fetch('/api/file', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, threads }),
  });
  if (!res.ok) {
    throw new Error(`PATCH /api/file failed: ${res.status}`);
  }
}

// ---------------------------------------------------------------------------
// Zustand store
// ---------------------------------------------------------------------------

export const useStore = create<StoreState>((set, get) => ({
  threads: [],
  filePath: null,
  raw: '',
  mtime: 0,
  user: '',
  loading: false,
  error: null,
  isPersisting: false,
  showResolved: false,
  showDiff: false,
  diffHunks: [],

  setShowResolved: (show: boolean) => set({ showResolved: show }),

  setShowDiff: async (show: boolean) => {
    if (!show) {
      set({ showDiff: false, diffHunks: [] });
      return;
    }
    const { filePath } = get();
    if (!filePath) return;
    try {
      const res = await fetch(`/api/diff?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) throw new Error(`diff failed: ${res.status}`);
      const data = await res.json() as { hunks: DiffHunk[] };
      set({ showDiff: true, diffHunks: data.hunks });
    } catch {
      set({ showDiff: false, diffHunks: [], error: 'Could not load git diff.' });
    }
  },

  // -------------------------------------------------------------------------
  // loadFile: GET /api/file?path=...
  // -------------------------------------------------------------------------
  loadFile: async (path: string) => {
    set({ loading: true, error: null });
    try {
      const res = await fetch(`/api/file?path=${encodeURIComponent(path)}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `GET /api/file failed: ${res.status}`);
      }
      const data = await res.json() as { raw: string; threads: Thread[]; mtime: number };
      addRecentFile(path);
      set({
        filePath: path,
        raw: data.raw,
        threads: data.threads,
        mtime: data.mtime,
        loading: false,
      });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  // -------------------------------------------------------------------------
  // setUser: write to localStorage + update store
  // -------------------------------------------------------------------------
  setUser: (user: string) => {
    try {
      localStorage.setItem('mdreview-user', user);
    } catch {
      // localStorage may not be available (SSR/test env)
    }
    set({ user });
  },

  // -------------------------------------------------------------------------
  // addThread: optimistic add + persist
  // -------------------------------------------------------------------------
  addThread: async (anchor: SelectionAnchor, text: string): Promise<Thread | null> => {
    const { filePath, threads, user } = get();
    if (!filePath) return null;

    const threadId = uuid();
    const commentId = uuid();
    const now = new Date().toISOString();

    const comment: Comment = {
      id: commentId,
      threadId,
      author: user,
      authorType: 'human',
      createdAt: now,
      text,
      anchor,
    };

    const thread: Thread = {
      id: threadId,
      resolved: false,
      comments: [comment],
    };

    // Optimistic update
    const newThreads = [...threads, thread];
    set({ threads: newThreads, isPersisting: true });

    try {
      await persistToServer(filePath, newThreads);
      set({ isPersisting: false });
      return thread;
    } catch {
      // Rollback
      set({ threads, isPersisting: false, error: 'Failed to save comment. Please try again.' });
      return null;
    }
  },

  // -------------------------------------------------------------------------
  // addReply: append comment to existing thread + persist
  // -------------------------------------------------------------------------
  addReply: async (
    threadId: string,
    text: string,
    authorType: 'human' | 'llm' = 'human',
    author?: string,
  ): Promise<Comment | null> => {
    const { filePath, threads, user } = get();
    if (!filePath) return null;

    const targetThread = threads.find(t => t.id === threadId);
    if (!targetThread) return null;

    const commentId = uuid();
    const now = new Date().toISOString();

    // Use the anchor from the first comment in the thread
    const anchorFromThread = targetThread.comments[0]?.anchor ?? {
      quote: '',
      startOffset: 0,
      endOffset: 0,
      xpath: '',
    };

    const comment: Comment = {
      id: commentId,
      threadId,
      author: author ?? user,
      authorType,
      createdAt: now,
      text,
      anchor: anchorFromThread,
    };

    const newThreads = threads.map(t => {
      if (t.id !== threadId) return t;
      return { ...t, comments: [...t.comments, comment] };
    });

    // Optimistic update
    set({ threads: newThreads, isPersisting: true });

    try {
      await persistToServer(filePath, newThreads);
      set({ isPersisting: false });
      return comment;
    } catch {
      // Rollback
      set({ threads, isPersisting: false, error: 'Failed to save reply. Please try again.' });
      return null;
    }
  },

  // -------------------------------------------------------------------------
  // resolveThread: flip resolved flag + persist
  // -------------------------------------------------------------------------
  resolveThread: async (threadId: string, resolved: boolean): Promise<void> => {
    const { filePath, threads } = get();
    if (!filePath) return;

    const prevThreads = threads;
    const newThreads = threads.map(t => {
      if (t.id !== threadId) return t;
      return { ...t, resolved };
    });

    // Optimistic update
    set({ threads: newThreads, isPersisting: true });

    try {
      await persistToServer(filePath, newThreads);
      set({ isPersisting: false });
    } catch {
      // Rollback
      set({ threads: prevThreads, isPersisting: false, error: 'Failed to update thread. Please try again.' });
    }
  },

  // -------------------------------------------------------------------------
  // setThreads: replace store threads + mtime (used by polling)
  // -------------------------------------------------------------------------
  setThreads: (threads: Thread[], mtime: number) => {
    set({ threads, mtime });
  },

  // -------------------------------------------------------------------------
  // clearError: dismiss the current error banner
  // -------------------------------------------------------------------------
  clearError: () => {
    set({ error: null });
  },

  // -------------------------------------------------------------------------
  // startPolling: GET /api/file every intervalMs, update if mtime changed
  // -------------------------------------------------------------------------
  startPolling: (intervalMs = 5000): (() => void) => {
    const { filePath } = get();
    if (!filePath) {
      // Return a no-op stop function
      return () => {};
    }

    const id = setInterval(async () => {
      const currentFilePath = get().filePath;
      if (!currentFilePath) return;

      // Do not clobber in-flight optimistic updates
      if (get().isPersisting) return;

      try {
        const res = await fetch(`/api/file?path=${encodeURIComponent(currentFilePath)}`);
        if (!res.ok) return;
        const data = await res.json() as { raw: string; threads: Thread[]; mtime: number };
        // Re-check isPersisting after the async fetch — a PATCH may have started
        if (!get().isPersisting && data.mtime !== get().mtime) {
          set({ threads: data.threads, mtime: data.mtime, raw: data.raw });
        }
      } catch {
        // Silently ignore polling errors — do NOT set store.error
      }
    }, intervalMs);

    return () => clearInterval(id);
  },
}));

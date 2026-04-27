const STORAGE_KEY = 'mdreview-user';
const RECENT_FILES_KEY = 'mdreview-recent-files';
const MAX_RECENT = 10;

// ---------------------------------------------------------------------------
// parseUrlParams
// ---------------------------------------------------------------------------

/**
 * Read `file`, `user`, and `thread` from the current page's query string.
 */
export function parseUrlParams(): { file: string | null; user: string | null; thread: string | null } {
  const params = new URLSearchParams(window.location.search);
  return {
    file: params.get('file'),
    user: params.get('user'),
    thread: params.get('thread'),
  };
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

/**
 * Return the stored user name, or null if not set.
 */
export function getStoredUser(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Persist a user name to localStorage.
 */
export function setStoredUser(user: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, user);
  } catch {
    // localStorage may not be available in some environments
  }
}

// ---------------------------------------------------------------------------
// Recent files
// ---------------------------------------------------------------------------

export function getRecentFiles(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_FILES_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function addRecentFile(path: string): void {
  try {
    const list = getRecentFiles().filter((p) => p !== path);
    list.unshift(path);
    localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(list.slice(0, MAX_RECENT)));
  } catch {
    // ignore
  }
}

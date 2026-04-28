import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  parseUrlParams,
  getStoredUser,
  setStoredUser,
} from '../../src/client/lib/share';

// ---------------------------------------------------------------------------
// Helpers: mock window.location
// ---------------------------------------------------------------------------

/** Override window.location for the duration of a test. */
function withLocation(
  overrides: { search?: string; origin?: string; pathname?: string },
  fn: () => void,
): void {
  const originalLocation = window.location;

  // happy-dom allows reassigning window.location properties directly
  // via Object.defineProperty on the window object
  const fakeLocation = {
    search: overrides.search ?? '',
    origin: overrides.origin ?? 'http://localhost:3000',
    pathname: overrides.pathname ?? '/',
    href: '',
    hash: '',
    host: '',
    hostname: '',
    port: '',
    protocol: '',
    assign: () => {},
    replace: () => {},
    reload: () => {},
    toString: () => '',
  };

  try {
    Object.defineProperty(window, 'location', {
      value: fakeLocation,
      writable: true,
      configurable: true,
    });
    fn();
  } finally {
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  }
}

// ---------------------------------------------------------------------------
// parseUrlParams
// ---------------------------------------------------------------------------

describe('parseUrlParams', () => {
  it('parses file, user, and thread from query string', () => {
    withLocation({ search: '?file=/docs/test.md&user=alice&thread=t-123' }, () => {
      const result = parseUrlParams();
      expect(result.file).toBe('/docs/test.md');
      expect(result.user).toBe('alice');
      expect(result.thread).toBe('t-123');
    });
  });

  it('returns null for missing params', () => {
    withLocation({ search: '' }, () => {
      const result = parseUrlParams();
      expect(result.file).toBeNull();
      expect(result.user).toBeNull();
      expect(result.thread).toBeNull();
    });
  });

  it('parses only file when user and thread are absent', () => {
    withLocation({ search: '?file=/path/to/doc.md' }, () => {
      const result = parseUrlParams();
      expect(result.file).toBe('/path/to/doc.md');
      expect(result.user).toBeNull();
      expect(result.thread).toBeNull();
    });
  });

  it('handles URL-encoded file paths', () => {
    withLocation({ search: '?file=%2Fabs%2Fpath%2Fdoc.md&user=bob' }, () => {
      const result = parseUrlParams();
      expect(result.file).toBe('/abs/path/doc.md');
      expect(result.user).toBe('bob');
    });
  });
});

// ---------------------------------------------------------------------------
// localStorage round-trip: setStoredUser / getStoredUser
// ---------------------------------------------------------------------------

describe('getStoredUser / setStoredUser', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns null when nothing is stored', () => {
    expect(getStoredUser()).toBeNull();
  });

  it('round-trips: setStoredUser then getStoredUser returns same value', () => {
    setStoredUser('alice');
    expect(getStoredUser()).toBe('alice');
  });

  it('overwrites the previous value', () => {
    setStoredUser('alice');
    setStoredUser('bob');
    expect(getStoredUser()).toBe('bob');
  });

  it('stores under the correct localStorage key', () => {
    setStoredUser('carol');
    expect(localStorage.getItem('mdreview-user')).toBe('carol');
  });
});


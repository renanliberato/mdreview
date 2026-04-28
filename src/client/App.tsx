import React, { useEffect, useRef, useCallback } from 'react';
import { useStore } from './lib/store';
import { parseUrlParams } from './lib/share';
import { FilePicker } from './components/FilePicker';
import { MarkdownView } from './components/MarkdownView';
import { ThreadSidebar } from './components/ThreadSidebar';
import { OnboardingPopup } from './components/OnboardingPopup';

export function App(): React.JSX.Element {
  const filePath   = useStore((s) => s.filePath);
  const loading    = useStore((s) => s.loading);
  const error      = useStore((s) => s.error);
  const user       = useStore((s) => s.user);
  const raw        = useStore((s) => s.raw);
  const showDiff   = useStore((s) => s.showDiff);
  const loadFile   = useStore((s) => s.loadFile);
  const setUser    = useStore((s) => s.setUser);
  const clearError = useStore((s) => s.clearError);
  const startPolling = useStore((s) => s.startPolling);
  const setShowDiff  = useStore((s) => s.setShowDiff);

  // Keep a stable ref to the stop-polling callback
  const stopPollingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    document.title = filePath ? filePath : 'mdreview';
  }, [filePath]);

  useEffect(() => {
    const { file, user: urlUser } = parseUrlParams();

    // Seed user from URL param if present (store already has localStorage value
    // if setStoredUser was called in main.tsx, but we sync it into the store here)
    if (urlUser && !user) {
      setUser(urlUser);
    }

    if (file) {
      loadFile(file).then(() => {
        stopPollingRef.current = startPolling();
      });
    }

    return () => {
      stopPollingRef.current?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  const handleToggleDiff = useCallback(() => {
    setShowDiff(!showDiff);
  }, [showDiff, setShowDiff]);

  const handleExport = useCallback(() => {
    if (!filePath || !raw) return;
    const filename = filePath.split('/').pop() ?? 'document.md';
    const blob = new Blob([raw], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [filePath, raw]);

  const handleUserChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setUser(e.target.value);
    },
    [setUser],
  );

  // No file param — show FilePicker
  const { file: urlFile } = parseUrlParams();
  if (!urlFile) {
    return <FilePicker />;
  }

  return (
    <div className="app-layout">
      {error && (
        <div className="error-banner" role="alert">
          <span className="error-banner__message">{error}</span>
          <button
            className="error-banner__close"
            onClick={clearError}
            aria-label="Dismiss error"
            type="button"
          >
            ✕
          </button>
        </div>
      )}

      <header className="app-header">
        <button
          className="app-header__back-btn"
          onClick={() => { window.location.search = ''; }}
          title="Back to home"
          type="button"
          aria-label="Back to home"
        >
          ← Back
        </button>

        <span className="app-header__filepath" title={filePath ?? ''}>
          {filePath ?? '—'}
        </span>

        {loading && <span className="app-header__status">Loading…</span>}

        <input
          className="app-header__user-input"
          type="text"
          placeholder="Your name"
          value={user}
          onChange={handleUserChange}
          aria-label="Username"
        />

        <button
          className={`app-header__btn${showDiff ? ' app-header__btn--active' : ''}`}
          onClick={handleToggleDiff}
          disabled={!filePath}
          title="Toggle git diff highlights"
        >
          ± Diff
        </button>

        <button
          className="app-header__btn"
          onClick={handleExport}
          disabled={!filePath || !raw}
          title="Download markdown file"
        >
          ↓ Export
        </button>

      </header>

      <OnboardingPopup fileLoaded={!!filePath} />

      <div className="app-body">
        <main className="app-content">
          {loading && !filePath ? (
            <div className="loading-overlay">Loading file…</div>
          ) : (
            <MarkdownView />
          )}
        </main>

        <aside>
          <ThreadSidebar />
        </aside>
      </div>
    </div>
  );
}

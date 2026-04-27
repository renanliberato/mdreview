import React, { useState, useCallback, useRef, useMemo } from 'react';
import { getRecentFiles } from '../lib/share';

export function FilePicker(): React.JSX.Element {
  const [path, setPath] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recentFiles = useMemo(() => getRecentFiles(), []);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = path.trim();
      if (!trimmed) return;
      window.location.search = `?file=${encodeURIComponent(trimmed)}`;
    },
    [path],
  );

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setUploadError(null);

    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/file/upload', { method: 'POST', body: form });
      const data = await res.json() as { path?: string; error?: string };
      if (!res.ok || !data.path) {
        setUploadError(data.error ?? 'Upload failed');
        return;
      }
      window.location.search = `?file=${encodeURIComponent(data.path)}`;
    } catch {
      setUploadError('Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, []);

  return (
    <div className="file-picker">
      <div className="file-picker__card">
        <h1 className="file-picker__title">mdreview</h1>
        <p className="file-picker__subtitle">Open a markdown file to start reviewing.</p>

        <form onSubmit={handleSubmit}>
          <div className="file-picker__row">
            <input
              className="file-picker__input"
              type="text"
              placeholder="doc.md or subdir/doc.md"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              autoFocus
              aria-label="Path to markdown file"
            />
            <button
              className="file-picker__btn"
              type="submit"
              disabled={!path.trim()}
            >
              Open
            </button>
          </div>
        </form>

        <div className="file-picker__divider">or</div>

        <label className={`file-picker__upload-label${uploading ? ' file-picker__upload-label--busy' : ''}`}>
          {uploading ? 'Uploading…' : 'Upload .md file'}
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,text/markdown"
            onChange={handleUpload}
            disabled={uploading}
            aria-label="Upload markdown file"
            style={{ display: 'none' }}
          />
        </label>

        {uploadError && (
          <p className="file-picker__error">{uploadError}</p>
        )}

        <p className="file-picker__hint">
          Files are served from the <code>docs/</code> folder.
        </p>

        {recentFiles.length > 0 && (
          <div className="file-picker__recent">
            <p className="file-picker__recent-label">Recent files</p>
            <ul className="file-picker__recent-list">
              {recentFiles.map((f) => (
                <li key={f}>
                  <button
                    className="file-picker__recent-item"
                    type="button"
                    onClick={() => { window.location.search = `?file=${encodeURIComponent(f)}`; }}
                  >
                    {f}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

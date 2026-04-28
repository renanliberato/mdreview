import React, { useState, useEffect } from 'react';
import { useStore } from '../lib/store';
import type { Thread } from '../../shared/types';
import { ThreadPanel } from './ThreadPanel';

export function ThreadSidebar(): React.JSX.Element {
  const threads         = useStore((s) => s.threads);
  const showResolved    = useStore((s) => s.showResolved);
  const setShowResolved = useStore((s) => s.setShowResolved);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [collapsed, setCollapsed]   = useState(true);

  // Listen for cross-component "select thread" events dispatched by MarkdownView
  // when the user clicks a <mark> highlight.
  useEffect(() => {
    function handleSelectThread(e: Event): void {
      const detail = (e as CustomEvent<{ threadId: string }>).detail;
      setExpandedId(detail.threadId);
      setCollapsed(false);
      const thread = useStore.getState().threads.find((t) => t.id === detail.threadId);
      if (thread?.resolved) setShowResolved(true);
    }
    window.addEventListener('mdreview:select-thread', handleSelectThread);
    return () => window.removeEventListener('mdreview:select-thread', handleSelectThread);
  }, [setShowResolved]);

  const unresolvedCount = threads.filter((t) => !t.resolved).length;

  const visible = (showResolved ? threads : threads.filter((t) => !t.resolved))
    .slice()
    .sort((a, b) => {
      const aOff = a.comments[0]?.anchor.startOffset ?? 0;
      const bOff = b.comments[0]?.anchor.startOffset ?? 0;
      return aOff - bOff;
    });

  const expandedThread = expandedId != null
    ? threads.find((t) => t.id === expandedId) ?? null
    : null;

  function handleRowClick(thread: Thread): void {
    setExpandedId((prev) => (prev === thread.id ? null : thread.id));
    window.dispatchEvent(
      new CustomEvent('mdreview:scroll-to-thread', { detail: { threadId: thread.id } }),
    );
  }

  function handleClose(): void {
    setExpandedId(null);
  }

  return (
    <div className={`thread-sidebar${collapsed ? ' thread-sidebar--collapsed' : ''}`}>
      <div className="thread-sidebar__header">
        {!collapsed && <span className="thread-sidebar__title">Threads ({threads.length})</span>}
        {!collapsed && unresolvedCount > 0 && (
          <span className="thread-sidebar__badge">{unresolvedCount}</span>
        )}
        {!collapsed && (
          <div className="thread-sidebar__header-controls">
            <label className="thread-sidebar__filter">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={(e) => setShowResolved(e.target.checked)}
              />
              Show resolved
            </label>
          </div>
        )}
        <button
          className="thread-sidebar__collapse-btn"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'Expand comments' : 'Collapse comments'}
          type="button"
          aria-label={collapsed ? 'Expand comments' : 'Collapse comments'}
        >
          {collapsed ? '‹' : '›'}
        </button>
      </div>

      <div className={`thread-sidebar__list${collapsed ? ' thread-sidebar__list--hidden' : ''}`}>
        {visible.length === 0 ? (
          <div className="thread-sidebar__empty">
            {threads.length === 0
              ? 'No threads yet. Select text to add a comment.'
              : 'No unresolved threads.'}
          </div>
        ) : (
          visible.map((thread) => {
            const anchor = thread.comments[0]?.anchor;
            const quote  = anchor?.quote ?? '';
            const count  = thread.comments.length;
            const isActive = expandedId === thread.id;

            return (
              <div
                key={thread.id}
                className={`thread-row${isActive ? ' active' : ''}`}
                onClick={() => handleRowClick(thread)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') handleRowClick(thread);
                }}
              >
                <div className="thread-row__quote">{quote || '(no quote)'}</div>
                <div className="thread-row__meta">
                  <span className="thread-row__count">
                    {'💬'} {count} comment{count !== 1 ? 's' : ''}
                  </span>
                  {thread.resolved && (
                    <span className="thread-row__resolved-badge">Resolved</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {!collapsed && expandedThread && (
        <ThreadPanel thread={expandedThread} onClose={handleClose} />
      )}
    </div>
  );
}

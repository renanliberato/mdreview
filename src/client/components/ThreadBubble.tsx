import React from 'react';
import type { Thread } from '../../shared/types';

interface ThreadBubbleProps {
  thread: Thread;
  anchorRect: DOMRect;
  onClick: () => void;
}

/**
 * Minimal floating badge displayed to the right of the anchored text.
 * For MVP the primary highlight UX is the <mark> element; this bubble
 * adds a comment-count badge alongside it.
 */
export function ThreadBubble({ thread, anchorRect, onClick }: ThreadBubbleProps): React.JSX.Element {
  const count = thread.comments.length;

  return (
    <div
      className={`thread-bubble${thread.resolved ? ' resolved' : ''}`}
      style={{
        top:  anchorRect.top  + window.scrollY + (anchorRect.height / 2) - 10,
        left: anchorRect.right + window.scrollX + 4,
      }}
      onClick={onClick}
      title={`${count} comment${count !== 1 ? 's' : ''}${thread.resolved ? ' (resolved)' : ''}`}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(); }}
      aria-label={`Thread with ${count} comment${count !== 1 ? 's' : ''}`}
    >
      {count}
    </div>
  );
}

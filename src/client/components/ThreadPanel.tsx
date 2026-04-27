import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { Thread } from '../../shared/types';
import { useStore } from '../lib/store';

interface ThreadPanelProps {
  thread: Thread;
  onClose: () => void;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = now - d.getTime();
    const diffMin = Math.floor(diffMs / 60_000);
    if (diffMin < 1)  return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24)   return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    return `${diffD}d ago`;
  } catch {
    return iso;
  }
}

export function ThreadPanel({ thread, onClose }: ThreadPanelProps): React.JSX.Element {
  const addReply      = useStore((s) => s.addReply);
  const resolveThread = useStore((s) => s.resolveThread);
  const user          = useStore((s) => s.user);

  const [replyText, setReplyText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const anchor = thread.comments[0]?.anchor;
  const quote  = anchor?.quote ?? '';

  const handleResolveToggle = useCallback(() => {
    resolveThread(thread.id, !thread.resolved);
  }, [thread.id, thread.resolved, resolveThread]);

  const handleReply = useCallback(async () => {
    const trimmed = replyText.trim();
    if (!trimmed || submitting) return;
    if (!user.trim()) {
      // eslint-disable-next-line no-alert
      window.alert('Please enter your name in the "Your name" field before replying.');
      return;
    }
    setSubmitting(true);
    await addReply(thread.id, trimmed);
    setReplyText('');
    setSubmitting(false);
    textareaRef.current?.focus();
  }, [replyText, submitting, addReply, thread.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleReply();
      }
    },
    [handleReply],
  );

  // Scroll to bottom of comments when new ones arrive
  const commentsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread.comments.length]);

  return (
    <div className="thread-panel">
      <div className="thread-panel__header">
        <span className="thread-panel__quote" title={quote}>{quote}</span>
        <button
          className={`thread-panel__resolve-btn${thread.resolved ? ' resolved' : ''}`}
          onClick={handleResolveToggle}
          type="button"
          title={thread.resolved ? 'Reopen thread' : 'Resolve thread'}
        >
          {thread.resolved ? '✓ Resolved' : 'Resolve'}
        </button>
        <button
          className="thread-panel__close-btn"
          onClick={onClose}
          type="button"
          aria-label="Close thread panel"
        >
          ✕
        </button>
      </div>

      <div className="thread-panel__comments">
        {thread.comments.map((comment) => (
          <div key={comment.id} className="comment-item">
            <div className="comment-item__header">
              <span className="comment-item__author">{comment.author || 'Anonymous'}</span>
              {comment.authorType === 'llm' && (
                <span className="comment-item__llm-badge">LLM</span>
              )}
              <span className="comment-item__time">{formatTime(comment.createdAt)}</span>
            </div>
            <div className="comment-item__text">{comment.text}</div>
          </div>
        ))}
        <div ref={commentsEndRef} />
      </div>

      <div className="thread-panel__footer">
        <textarea
          ref={textareaRef}
          className="thread-panel__reply-input"
          placeholder="Reply… (⌘/Ctrl+Enter to submit)"
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={submitting}
        />
        <button
          className="thread-panel__reply-btn"
          onClick={handleReply}
          disabled={!replyText.trim() || submitting}
          type="button"
        >
          Reply
        </button>
      </div>
    </div>
  );
}

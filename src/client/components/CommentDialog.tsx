import React, { useState, useCallback, useEffect, useRef } from 'react';
import type { SelectionAnchor } from '../../shared/types';
import { useStore } from '../lib/store';

interface Position {
  x: number;
  y: number;
}

interface CommentDialogProps {
  anchor: SelectionAnchor;
  position: Position;
  onSubmit: (text: string) => void;
  onCancel: () => void;
}

export function CommentDialog({
  anchor,
  position,
  onSubmit,
  onCancel,
}: CommentDialogProps): React.JSX.Element {
  const user = useStore((s) => s.user);
  const setUser = useStore((s) => s.setUser);
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Click outside the dialog → cancel.
  // The dialog already stops mousedown propagation on its own root, so a
  // document-level listener only fires for outside clicks.
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent): void {
      const root = rootRef.current;
      if (!root) return;
      if (root.contains(e.target as Node)) return;
      onCancel();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [onCancel]);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!user.trim()) {
      // eslint-disable-next-line no-alert
      const name = window.prompt('Enter your name before commenting:');
      if (!name?.trim()) return;
      setUser(name.trim());
    }
    onSubmit(trimmed);
  }, [text, user, onSubmit, setUser]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [onCancel, handleSubmit],
  );

  // Clamp position so dialog stays within viewport
  const DIALOG_W = 280;
  const DIALOG_H = 160;
  const left = Math.min(position.x, window.innerWidth - DIALOG_W - 8);
  const top  = Math.min(position.y, window.innerHeight - DIALOG_H - 8);

  return (
    <div
      ref={rootRef}
      className="comment-dialog"
      style={{ left, top }}
      // Prevent mouse events from reaching MarkdownView (clears selection / triggers re-anchor)
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
    >
      <div style={{ fontSize: 11, color: '#888', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        &ldquo;{anchor.quote}&rdquo;
      </div>
      <textarea
        ref={textareaRef}
        className="comment-dialog__textarea"
        placeholder="Add a comment…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="comment-dialog__actions">
        <span className="comment-dialog__hint">{'⌘'}/Ctrl+{'⏎'} to submit</span>
        <button className="comment-dialog__cancel-btn" onClick={onCancel} type="button">
          Cancel
        </button>
        <button
          className="comment-dialog__submit-btn"
          onClick={handleSubmit}
          disabled={!text.trim()}
          type="button"
        >
          Comment
        </button>
      </div>
    </div>
  );
}

import React, {
  useRef,
  useMemo,
  useEffect,
  useState,
  useCallback,
} from 'react';
import { useStore } from '../lib/store';
import { renderMarkdown } from '../lib/renderer';
import { captureSelection } from '../lib/selection';
import { findAnchorInDom, wrapAnchor, unwrapPendingMark } from '../lib/anchor';
import { CommentDialog } from './CommentDialog';
import { applyDiffHighlights, removeDiffHighlights } from '../lib/diffHighlight';
import type { SelectionAnchor } from '../../shared/types';

interface DialogState {
  anchor: SelectionAnchor;
  position: { x: number; y: number };
}

interface TooltipState {
  anchor: SelectionAnchor;
  tooltipPos: { x: number; y: number };
  dialogPos: { x: number; y: number };
}

export function MarkdownView(): React.JSX.Element {
  const raw          = useStore((s) => s.raw);
  const threads      = useStore((s) => s.threads);
  const showResolved = useStore((s) => s.showResolved);
  const showDiff     = useStore((s) => s.showDiff);
  const diffHunks    = useStore((s) => s.diffHunks);
  const addThread    = useStore((s) => s.addThread);

  const containerRef = useRef<HTMLDivElement>(null);

  // Memoise rendered HTML so it doesn't re-render on every keystroke
  const html = useMemo(() => (raw ? renderMarkdown(raw) : ''), [raw]);

  // Set innerHTML imperatively (only when html actually changes), so React
  // re-renders triggered by other state (e.g. dialog) don't wipe imperatively-
  // added <mark> elements via dangerouslySetInnerHTML re-application.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    if (container.innerHTML !== html) {
      container.innerHTML = html;
    }
  }, [html]);

  // Tooltip state: shown right after a selection finishes (hint to press Shift+C)
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  // Dialog state: shown after the user confirms (Shift+C or clicks the tooltip)
  const [dialog, setDialog] = useState<DialogState | null>(null);

  // After the HTML is injected into the DOM, wrap each known thread anchor.
  // The :not([data-thread-id="__pending__"]) filter preserves the in-flight
  // selection mark while threads update around it.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !html) return;

    container.querySelectorAll('mark.mdreview-highlight:not([data-thread-id="__pending__"])').forEach((mark) => {
      const parent = mark.parentNode;
      if (parent) {
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
      }
    });

    for (const thread of threads) {
      if (thread.resolved && !showResolved) continue;
      const anchor = thread.comments[0]?.anchor;
      if (!anchor) continue;
      try {
        const range = findAnchorInDom(anchor, container);
        if (range) wrapAnchor(range, thread.id);
      } catch {
        // Ignore anchoring failures (orphaned threads still appear in sidebar)
      }
    }
  }, [html, threads, showResolved]);

  // -------------------------------------------------------------------------
  // Diff highlights: apply/remove whenever showDiff or hunks change
  // -------------------------------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    removeDiffHighlights(container);
    if (showDiff && diffHunks.length > 0) {
      applyDiffHighlights(container, diffHunks);
    }
  }, [showDiff, diffHunks, html]);

  // -------------------------------------------------------------------------
  // Mouse-up: capture selection, show hotkey tooltip above the selection
  // -------------------------------------------------------------------------
  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;

      // If the mouse-up happened inside a <mark> (user clicked on an existing
      // highlight) → do not open the comment dialog; let the click handler
      // below handle mark clicks instead.
      const target = e.target as Element;
      if (target.closest('mark.mdreview-highlight')) return;

      const anchor = captureSelection(container);
      if (!anchor) {
        // Click without a selection inside the markdown area → dismiss any
        // lingering tooltip + pending mark.
        setTooltip(null);
        unwrapPendingMark(container);
        return;
      }

      // A previous tooltip may still own a pending mark on an earlier
      // selection. Drop it before we wrap the new one so only the active
      // selection stays highlighted.
      unwrapPendingMark(container);

      // Position tooltip above the selection; keep dialog position below for
      // when the user promotes the tooltip into the dialog.
      const sel = window.getSelection();
      let dialogX = e.clientX;
      let dialogY = e.clientY + 8;
      let tooltipX = e.clientX;
      let tooltipY = e.clientY - 32;
      let savedRange: Range | null = null;
      if (sel && sel.rangeCount > 0) {
        const r = sel.getRangeAt(0);
        const rect = r.getBoundingClientRect();
        dialogX = rect.left;
        dialogY = rect.bottom + 8;
        tooltipX = rect.left;
        tooltipY = rect.top - 32;
        savedRange = r.cloneRange();
      }

      if (!savedRange) return;

      // Wrap the pending selection so the highlight survives losing focus.
      wrapAnchor(savedRange, '__pending__');
      window.getSelection()?.removeAllRanges();

      setTooltip({
        anchor,
        tooltipPos: { x: tooltipX, y: tooltipY },
        dialogPos: { x: dialogX, y: dialogY },
      });
    },
    [],
  );

  // Promote tooltip → dialog (triggered by Shift+C or clicking the tooltip)
  const openDialogFromTooltip = useCallback(() => {
    setTooltip((current) => {
      if (!current) return null;
      setDialog({ anchor: current.anchor, position: current.dialogPos });
      return null;
    });
  }, []);

  const dismissTooltip = useCallback(() => {
    setTooltip(null);
    unwrapPendingMark(containerRef.current);
  }, []);

  // Global key listener: Shift+C confirms, Escape dismisses (only while tooltip is up)
  useEffect(() => {
    if (!tooltip) return;
    function onKeyDown(e: KeyboardEvent): void {
      // Don't hijack typing in inputs / textareas / contenteditable
      const t = e.target as Element | null;
      if (t && t.closest('input, textarea, [contenteditable="true"]')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        dismissTooltip();
        return;
      }
      // Shift+C — works on every OS, no conflict with browser/system shortcuts
      if (e.shiftKey && (e.code === 'KeyC' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        openDialogFromTooltip();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tooltip, openDialogFromTooltip, dismissTooltip]);

  // -------------------------------------------------------------------------
  // Listen for scroll-to-thread events dispatched by ThreadSidebar row clicks
  // -------------------------------------------------------------------------
  useEffect(() => {
    function handleScrollToThread(e: Event): void {
      const { threadId } = (e as CustomEvent<{ threadId: string }>).detail;
      const container = containerRef.current;
      if (!container) return;
      const mark = container.querySelector(`mark.mdreview-highlight[data-thread-id="${CSS.escape(threadId)}"]`);
      if (!mark) return;
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      mark.classList.remove('bump');
      // Force reflow so re-adding the class restarts the animation
      void (mark as HTMLElement).offsetWidth;
      mark.classList.add('bump');
      mark.addEventListener('animationend', () => mark.classList.remove('bump'), { once: true });
    }
    window.addEventListener('mdreview:scroll-to-thread', handleScrollToThread);
    return () => window.removeEventListener('mdreview:scroll-to-thread', handleScrollToThread);
  }, []);

  // -------------------------------------------------------------------------
  // Click delegation: <mark data-thread-id="..."> → select that thread
  // -------------------------------------------------------------------------
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as Element;
      const mark = target.closest('mark.mdreview-highlight');
      if (!mark) return;

      const threadId = (mark as HTMLElement).dataset.threadId;
      if (!threadId) return;

      // Dispatch a custom event so ThreadSidebar (or anyone) can listen.
      // ThreadSidebar manages its own expandedId state, so we use a window event
      // as a lightweight cross-component signal.
      window.dispatchEvent(
        new CustomEvent('mdreview:select-thread', { detail: { threadId } }),
      );
    },
    [],
  );

  // -------------------------------------------------------------------------
  // Dialog submit / cancel
  // -------------------------------------------------------------------------
  const handleDialogSubmit = useCallback(
    async (text: string) => {
      if (!dialog) return;
      setDialog(null);
      unwrapPendingMark(containerRef.current);
      await addThread(dialog.anchor, text);
    },
    [dialog, addThread],
  );

  const handleDialogCancel = useCallback(() => {
    setDialog(null);
    unwrapPendingMark(containerRef.current);
  }, []);

  return (
    <>
      <div
        className="md-content"
        ref={containerRef}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
      />

      {tooltip && (
        <button
          type="button"
          className="comment-tooltip"
          style={{ left: tooltip.tooltipPos.x, top: tooltip.tooltipPos.y }}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            openDialogFromTooltip();
          }}
        >
          <kbd>⇧C</kbd> comment
        </button>
      )}

      {dialog && (
        <CommentDialog
          anchor={dialog.anchor}
          position={dialog.position}
          onSubmit={handleDialogSubmit}
          onCancel={handleDialogCancel}
        />
      )}
    </>
  );
}

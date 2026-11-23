import { useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';

const dialogs: HTMLDivElement[] = [];
let bodyOverflow = '';
const focusable = 'button, input, select, textarea, a[href], summary, [contenteditable="true"], [tabindex]';

function tabStops(panel: HTMLElement) {
  return [...panel.querySelectorAll<HTMLElement>(focusable)].filter(element =>
    element.tabIndex >= 0 && !element.matches(':disabled') &&
    !element.closest('[inert], [hidden]') && element.getClientRects().length > 0
  );
}

export default function Modal({ title, children, onClose, wide = false, className = '' }: {
  title: string; children: ReactNode; onClose: () => void; wide?: boolean; className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // React applies a child's autoFocus during commit. Capture its opener before that.
  const opener = useRef(document.activeElement);
  const initialFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const closing = useRef(false);
  const pressedBackdrop = useRef(false);
  closeRef.current = onClose;

  function requestClose() {
    const node = panel.current;
    const backdrop = node?.parentElement;
    if (!node || !backdrop || closing.current || node.closest('[inert]') || dialogs.at(-1) !== node) return;
    closing.current = true;
    backdrop.dataset.closing = '';
    // CSS controls timing and reduced-motion behavior. Only wait for our two surfaces.
    const animations = [...(backdrop.getAnimations?.() ?? []), ...(node.getAnimations?.() ?? [])];
    function finish() {
      if (node !== panel.current || !closing.current) return;
      closing.current = false;
      closeRef.current();
    }
    if (animations.length) void Promise.allSettled(animations.map(animation => animation.finished)).then(finish);
    else finish();
  }

  useLayoutEffect(() => {
    const node = panel.current!;
    if (!dialogs.length) {
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    dialogs.push(node);
    if (node.contains(document.activeElement) && document.activeElement instanceof HTMLElement) {
      initialFocus.current = document.activeElement;
    } else {
      (initialFocus.current ?? tabStops(node)[0] ?? node).focus({ preventScroll: true });
    }

    function focusInside(event: FocusEvent) {
      if (dialogs.at(-1) !== node || node.closest('[inert]') || node.contains(event.target as Node)) return;
      // A newly mounted sibling can autofocus before its layout effect registers it.
      const incoming = event.target instanceof Element ? event.target.closest<HTMLDivElement>('.modal-panel') : null;
      if (incoming && !dialogs.includes(incoming)) return;
      (tabStops(node)[0] ?? node).focus({ preventScroll: true });
    }
    function handleKey(event: KeyboardEvent) {
      if (dialogs.at(-1) !== node || node.closest('[inert]') || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (closing.current) { event.preventDefault(); return; }
      if (event.key === 'Escape') { event.preventDefault(); requestClose(); return; }
      if (event.key !== 'Tab') return;
      const targets = tabStops(node);
      const first = targets[0], last = targets.at(-1);
      const active = document.activeElement;
      if (!first || active === node || !node.contains(active)) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault(); first.focus();
      }
    }
    document.addEventListener('keydown', handleKey);
    document.addEventListener('focusin', focusInside);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('focusin', focusInside);
      const wasTop = dialogs.at(-1) === node;
      dialogs.splice(dialogs.indexOf(node), 1);
      closing.current = false;
      if (!dialogs.length) document.body.style.overflow = bodyOverflow;
      const previous = opener.current;
      if (wasTop && previous instanceof HTMLElement && previous.isConnected) {
        if (!previous.closest('[inert], [hidden]')) previous.focus({ preventScroll: true });
        else if (dialogs.length) {
          // React may remove the lower dialog's inert/hidden state later in this commit.
          const remaining = dialogs.at(-1)!;
          queueMicrotask(() => {
            if (dialogs.at(-1) === remaining && remaining.contains(previous) &&
                !remaining.contains(document.activeElement) && !previous.closest('[inert], [hidden]')) {
              previous.focus({ preventScroll: true });
            }
          });
        }
      }
    };
  }, []);

  return <div className="modal-backdrop"
    onPointerDown={event => { pressedBackdrop.current = event.target === event.currentTarget && event.button === 0; }}
    onPointerCancel={() => { pressedBackdrop.current = false; }}
    onClickCapture={event => { if (closing.current) { event.preventDefault(); event.stopPropagation(); } }}
    onClick={event => {
      if (pressedBackdrop.current && event.target === event.currentTarget) requestClose();
      pressedBackdrop.current = false;
    }}>
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`modal-panel ${wide ? 'modal-wide' : ''} ${className}`}>
      <div className="modal-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label="关闭弹窗" onClick={requestClose}><X size={20}/></button></div>
      <div className="modal-content">{children}</div>
    </div>
  </div>;
}

import { useEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

/** Native disclosure with action-menu dismissal and optional arrow-key navigation. */
export default function ActionMenu({ className, children }: { className: string; children: ReactNode }) {
  const element = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const menu = element.current!;
    function dismissOutside(event: Event) {
      if (menu.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
    }
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('focusin', dismissOutside, true);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('focusin', dismissOutside, true);
    };
  }, []);

  function closeAndRestore(menu: HTMLDetailsElement) {
    const returnFocus = menu.contains(document.activeElement);
    menu.open = false;
    if (returnFocus) menu.querySelector('summary')?.focus({ preventScroll: true });
  }

  function handleKey(event: KeyboardEvent<HTMLDetailsElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    const menu = event.currentTarget;
    if (event.key === 'Escape' && menu.open) {
      event.preventDefault();
      event.stopPropagation();
      closeAndRestore(menu);
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (!menu.open && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const actions = [...menu.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')]
      .filter(action => !action.closest('[hidden], [inert]'));
    if (!actions.length) return;
    event.preventDefault();
    menu.open = true;
    const current = actions.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Home') actions[0].focus();
    else if (event.key === 'End') actions.at(-1)?.focus();
    else if (event.key === 'ArrowDown') actions[(current + 1) % actions.length].focus();
    else actions[(current <= 0 ? actions.length : current) - 1].focus();
  }

  return <details ref={element} className={className} onKeyDown={handleKey} onClick={event => {
    if (event.target instanceof Element && event.target.closest('button:enabled, a[href]')) closeAndRestore(event.currentTarget);
  }}>{children}</details>;
}

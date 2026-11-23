// @vitest-environment jsdom
import React, { act, StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Modal from '../src/components/Modal';
import ActionMenu from '../src/components/ActionMenu';

let host: HTMLDivElement;
let root: Root;
let opener: HTMLButtonElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => [{ width: 20 }] as unknown as DOMRectList);
  opener = document.createElement('button');
  host = document.createElement('div');
  document.body.append(opener, host);
  opener.focus();
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  opener.remove();
  document.body.style.overflow = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function key(key: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
  });
}

it('preserves the requested input focus, traps Tab and returns to the real opener when dismissed', async () => {
  function Rename() {
    const [open, setOpen] = useState(true);
    return open && <Modal title="重命名" onClose={() => setOpen(false)}><input autoFocus/><button disabled>保存</button></Modal>;
  }
  await act(async () => root.render(<StrictMode><Rename/></StrictMode>));
  expect(document.activeElement).toBe(host.querySelector('input'));
  await key('Tab');
  expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭弹窗');
  await key('Tab', { shiftKey: true });
  expect(document.activeElement).toBe(host.querySelector('input'));
  opener.focus();
  expect(host.contains(document.activeElement)).toBe(true);
  await key('Escape', { isComposing: true });
  expect(host.querySelector('[role="dialog"]')).toBeTruthy();
  await key('Escape');
  expect(host.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it('only dismisses the top dialog and keeps the underlying scroll lock and focus', async () => {
  document.body.style.overflow = 'auto';
  function Stacked() {
    const [outer, setOuter] = useState(true);
    const [nested, setNested] = useState(false);
    return outer && <><div inert={nested}><Modal title="模板" onClose={() => setOuter(false)}>
      <button id="child-opener" onClick={() => setNested(true)}>预览</button>
    </Modal></div>{nested && <Modal title="预览" onClose={() => setNested(false)}><input autoFocus/><button>使用</button></Modal>}</>;
  }
  await act(async () => root.render(<Stacked/>));
  const childOpener = host.querySelector<HTMLButtonElement>('#child-opener')!;
  childOpener.focus();
  await act(async () => childOpener.click());
  expect(host.querySelectorAll('[role="dialog"]').length).toBe(2);
  expect(document.activeElement).toBe(host.querySelector('input'));
  await key('Escape');
  expect(host.querySelectorAll('[role="dialog"]').length).toBe(1);
  expect(document.activeElement).toBe(childOpener);
  expect(document.body.style.overflow).toBe('hidden');
  await key('Escape');
  expect(document.body.style.overflow).toBe('auto');
  expect(document.activeElement).toBe(opener);
});

it('keeps the dialog open after a drag or canceled pointer and closes on a single backdrop click', async () => {
  const onClose = vi.fn();
  await act(async () => root.render(<Modal title="模板" onClose={onClose}><button>按钮</button></Modal>));
  const backdrop = host.querySelector<HTMLElement>('.modal-backdrop')!;
  const panel = host.querySelector<HTMLElement>('.modal-panel')!;
  const pointer = (target: HTMLElement, type: string) => target.dispatchEvent(new MouseEvent(type, { button: 0, bubbles: true }));
  await act(async () => {
    pointer(panel, 'pointerdown'); backdrop.click();
    pointer(backdrop, 'pointerdown'); pointer(backdrop, 'pointercancel'); backdrop.click();
  });
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => { pointer(backdrop, 'pointerdown'); backdrop.click(); });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('consumes repeated clicks and keys during exit and settles once the animation finishes', async () => {
  const onClose = vi.fn();
  const apply = vi.fn();
  await act(async () => root.render(<Modal title="模板" onClose={onClose}><button id="apply" onClick={apply}>使用</button></Modal>));
  const backdrop = host.querySelector<HTMLElement>('.modal-backdrop')!;
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  Object.defineProperty(backdrop, 'getAnimations', { value: () => [{ finished }] });
  await key('Escape');
  await key('Escape');
  await act(async () => host.querySelector<HTMLButtonElement>('#apply')!.click());
  expect(onClose).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();
  await act(async () => finish());
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('navigates enabled menu actions by keyboard and returns to the disclosure when an item runs', async () => {
  const onAction = vi.fn();
  await act(async () => root.render(<ActionMenu className="export-menu"><summary>格式</summary><div>
    <button disabled>PNG</button><button onClick={onAction}>Markdown</button><button>备份</button>
  </div></ActionMenu>));
  const menu = host.querySelector('details')!;
  const summary = menu.querySelector('summary')!;
  summary.focus();
  await key('ArrowDown');
  expect(menu.open).toBe(true);
  expect(document.activeElement?.textContent).toBe('Markdown');
  await key('ArrowUp');
  expect(document.activeElement?.textContent).toBe('备份');
  await key('Home');
  await act(async () => (document.activeElement as HTMLButtonElement).click());
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(menu.open).toBe(false);
  expect(document.activeElement).toBe(summary);
});

it('dismisses action menus on outside pointer or focus and consumes Escape before the enclosing dialog', async () => {
  const closeDialog = vi.fn();
  await act(async () => root.render(<Modal title="选择" onClose={closeDialog}>
    <ActionMenu className="options"><summary>信息项</summary><button>城市</button></ActionMenu>
    <button id="another">其他</button>
  </Modal>));
  const menu = host.querySelector('details')!;
  const summary = menu.querySelector('summary')!;
  summary.focus();
  await key('ArrowDown');
  await key('Escape');
  expect(menu.open).toBe(false);
  expect(document.activeElement).toBe(summary);
  expect(closeDialog).not.toHaveBeenCalled();
  await key('ArrowDown');
  host.querySelector<HTMLButtonElement>('#another')!.focus();
  expect(menu.open).toBe(false);
  summary.focus();
  await key('ArrowDown');
  await act(async () => { opener.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
  expect(menu.open).toBe(false);
});

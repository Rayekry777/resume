// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import PdfPreview from '../src/pdf/PdfPreview';

const { load, closeWorker } = vi.hoisted(() => ({ load: vi.fn(), closeWorker: vi.fn() }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: load, PDFWorker: class { destroy = closeWorker; } }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

function source(name: string) {
  const blob = new Blob([name]);
  Object.defineProperty(blob, 'arrayBuffer', { value: async () => new ArrayBuffer(1) });
  return blob;
}
function pdfPage() {
  let finish!: () => void;
  const page = {
    getViewport: ({ scale }: { scale: number }) => ({ width: 595 * scale, height: 842 * scale }),
    render: vi.fn(() => ({ promise: new Promise<void>(resolve => { finish = resolve; }), cancel: vi.fn() })),
    cleanup: vi.fn(),
  };
  const pdf = { numPages: 1, getPage: vi.fn(async () => page) };
  const task = { promise: Promise.resolve(pdf), destroy: vi.fn(async () => {}) };
  return { task, page, finish: () => finish() };
}

it('keeps the last complete page until the new raster is ready and coalesces resize bursts', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('IntersectionObserver', undefined);
  let resize!: () => void;
  class Observer {
    constructor(callback: () => void) { resize = callback; }
    observe() {} disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', Observer);
  let width = 600;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({} as CanvasRenderingContext2D));
  const host = document.createElement('div'), root = createRoot(host);
  const first = pdfPage(), next = pdfPage(), count = vi.fn();
  load.mockReturnValueOnce(first.task).mockReturnValueOnce(next.task);
  const a = source('first'), b = source('next');
  try {
    await act(async () => root.render(<PdfPreview blob={a} loading={false} onPageCount={count}/>));
    await act(async () => first.finish());
    const original = host.querySelector('canvas');
    expect(original?.width).toBe(600);
    await act(async () => root.render(<PdfPreview blob={a} loading onPageCount={count}/>));
    expect(host.querySelector('[role="status"]')?.textContent).toContain('正在更新预览');
    expect(host.querySelector('canvas')).toBe(original);
    await act(async () => root.render(<PdfPreview blob={b} loading={false} onPageCount={count}/>));
    expect(first.task.destroy).toHaveBeenCalledOnce();
    expect(load.mock.calls[0][0].worker).toBeDefined();
    expect(load.mock.calls[1][0].worker).toBe(load.mock.calls[0][0].worker);
    expect(closeWorker).not.toHaveBeenCalled();
    expect(host.querySelector('canvas')).toBe(original);
    await act(async () => next.finish());
    expect(host.querySelector('canvas')).not.toBe(original);
    expect(original?.width).toBe(0);
    for (width = 610; width <= 690; width += 10) {
      await act(async () => { resize(); await vi.advanceTimersByTimeAsync(10); });
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(next.page.render).toHaveBeenCalledTimes(2);
    await act(async () => next.finish());
    expect(host.querySelector('canvas')?.width).toBe(width);
    expect(count).toHaveBeenLastCalledWith(1);
  } finally {
    await act(async () => root.unmount());
  }
  expect(next.task.destroy).toHaveBeenCalledOnce();
  expect(closeWorker).toHaveBeenCalledOnce();
});

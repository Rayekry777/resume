import { describe, expect, it, vi } from 'vitest';
import { createThumbnailQueue } from '../src/pdf/thumbnailQueue';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise<void>(resolve => queueMicrotask(resolve));

describe('local PDF cover queue', () => {
  it('serializes visible requests, coalesces identical content and reuses exact cached results', async () => {
    const first = deferred<Blob>(), second = deferred<Blob>();
    const render = vi.fn((source: string) => source === 'first' ? first.promise : second.promise);
    const queue = createThumbnailQueue(render);
    const a = queue.request('first-revision', 'first'), duplicate = queue.request('first-revision', 'first'), b = queue.request('next-revision', 'second');
    await tick();
    expect(render.mock.calls.map(call => call[0])).toEqual(['first']);
    const imageA = new Blob(['first cover']); first.resolve(imageA);
    await expect(a.promise).resolves.toBe(imageA); await expect(duplicate.promise).resolves.toBe(imageA);
    expect(render.mock.calls.map(call => call[0])).toEqual(['first', 'second']);
    const imageB = new Blob(['new cover']); second.resolve(imageB);
    await expect(b.promise).resolves.toBe(imageB);
    await expect(queue.request('next-revision', 'second').promise).resolves.toBe(imageB);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('cancels offscreen queued work without cancelling another subscriber', async () => {
    const pending = deferred<Blob>();
    const render = vi.fn((_source: string, _signal: AbortSignal) => pending.promise), queue = createThumbnailQueue(render);
    const a = queue.request('shared', 'a'), shared = queue.request('shared', 'a'), hidden = queue.request('offscreen', 'b');
    const aError = a.promise.catch(error => error), hiddenError = hidden.promise.catch(error => error);
    await tick(); a.cancel(); hidden.cancel();
    expect((await aError).name).toBe('AbortError'); expect((await hiddenError).name).toBe('AbortError');
    expect(render.mock.calls[0][1].aborted).toBe(false);
    pending.resolve(new Blob(['visible'])); await shared.promise;
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('aborts the last subscriber and discards a late obsolete render instead of caching it', async () => {
    const stale = deferred<Blob>();
    let calls = 0, firstSignal: AbortSignal | undefined;
    const render = vi.fn((_source: string, signal: AbortSignal) => {
      calls++; if (calls === 1) { firstSignal = signal; return stale.promise; }
      return Promise.resolve(new Blob(['current']));
    });
    const queue = createThumbnailQueue(render), old = queue.request('same-key', 'same');
    const oldError = old.promise.catch(error => error);
    await tick(); old.cancel();
    expect(firstSignal?.aborted).toBe(true); expect((await oldError).name).toBe('AbortError');
    const current = queue.request('same-key', 'same');
    stale.resolve(new Blob(['obsolete']));
    expect(await (await current.promise).text()).toBe('current'); expect(render).toHaveBeenCalledTimes(2);
  });

  it('bounds cached image memory and evicts the least recently used cover', async () => {
    const render = vi.fn(async (source: string) => new Blob([source.repeat(2)]));
    const queue = createThumbnailQueue(render, { maxEntries: 2, maxBytes: 5 });
    await queue.request('a', 'a').promise; await queue.request('b', 'b').promise;
    await queue.request('a', 'a').promise;
    await queue.request('c', 'c').promise; await queue.request('a', 'a').promise;
    expect(render.mock.calls.map(call => call[0])).toEqual(['a', 'b', 'c']);
    await queue.request('b', 'b').promise;
    expect(render.mock.calls.map(call => call[0])).toEqual(['a', 'b', 'c', 'b']);
  });

  it('does not retain failures or oversized images and releases idle engine resources', async () => {
    const idle = vi.fn(); let failing = true;
    const render = vi.fn(async () => { if (failing) throw new Error('unavailable'); return new Blob(['large']); });
    const queue = createThumbnailQueue(render, { maxBytes: 2, onIdle: idle });
    await expect(queue.request('a', '').promise).rejects.toThrow('unavailable');
    failing = false;
    await queue.request('a', '').promise; await queue.request('a', '').promise;
    expect(render).toHaveBeenCalledTimes(3); expect(idle).toHaveBeenCalledTimes(3);
  });
});

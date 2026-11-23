export interface ThumbnailRequest { promise: Promise<Blob>; cancel: () => void }
interface Subscriber { resolve: (blob: Blob) => void; reject: (reason: Error) => void }
interface Job<Source> { key: string; source: Source; subscribers: Set<Subscriber>; controller: AbortController }
const cancelled = () => new DOMException('Thumbnail cancelled', 'AbortError');

/** One render at a time; cancelled/stale results never enter the bounded memory cache. */
export function createThumbnailQueue<Source>(render: (source: Source, signal: AbortSignal) => Promise<Blob>, options: { maxEntries?: number; maxBytes?: number; onIdle?: () => void } = {}) {
  const cache = new Map<string, Blob>();
  const pending = new Map<string, Job<Source>>();
  const jobs: Job<Source>[] = [];
  const maxEntries = options.maxEntries ?? 12, maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
  let running = false, cachedBytes = 0;
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (jobs.length) {
        const job = jobs.shift()!;
        if (!job.subscribers.size) continue;
        try {
          const blob = await render(job.source, job.controller.signal);
          if (job.controller.signal.aborted || !job.subscribers.size) continue;
          if (blob.size <= maxBytes) {
            cache.set(job.key, blob); cachedBytes += blob.size;
            while (cache.size > maxEntries || cachedBytes > maxBytes) {
              const oldest = cache.keys().next().value!;
              cachedBytes -= cache.get(oldest)!.size; cache.delete(oldest);
            }
          }
          for (const subscriber of job.subscribers) subscriber.resolve(blob);
        } catch (error) {
          const reason = error instanceof Error ? error : new Error('封面生成失败');
          for (const subscriber of job.subscribers) subscriber.reject(reason);
        } finally {
          job.subscribers.clear();
          if (pending.get(job.key) === job) pending.delete(job.key);
        }
      }
    } finally { running = false; options.onIdle?.(); }
  }
  return {
    request(key: string, source: Source): ThumbnailRequest {
      const cached = cache.get(key);
      if (cached) { cache.delete(key); cache.set(key, cached); return { promise: Promise.resolve(cached), cancel() {} }; }
      let job = pending.get(key);
      if (!job) {
        job = { key, source, subscribers: new Set(), controller: new AbortController() };
        pending.set(key, job); jobs.push(job);
      }
      let subscriber: Subscriber;
      const promise = new Promise<Blob>((resolve, reject) => { subscriber = { resolve, reject }; job!.subscribers.add(subscriber); });
      // Collect all visibility observations in this turn before starting the queue.
      queueMicrotask(() => { void drain(); });
      return { promise, cancel() {
        if (!job!.subscribers.delete(subscriber)) return;
        subscriber.reject(cancelled());
        if (!job!.subscribers.size) {
          job!.controller.abort();
          if (pending.get(key) === job) pending.delete(key);
        }
      } };
    },
  };
}

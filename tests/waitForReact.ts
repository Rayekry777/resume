import { act } from 'react';

/** IndexedDB completes on later tasks; React commits when each act finishes. */
export async function waitForReact(assertion: () => unknown, timeout = 3000): Promise<void> {
  const deadline = Date.now() + timeout;
  for (;;) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    try {
      await act(async () => { await assertion(); });
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
    }
  }
}

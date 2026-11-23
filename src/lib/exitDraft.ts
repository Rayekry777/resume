import type { ResumeDocument } from '../model';
import { validateResumeDocument } from './storage';

const key = (id: string) => 'resume:pending-exit:' + id;

// Only used while leaving the page. A refresh can cancel a pending IndexedDB
// transaction even after the browser has dispatched its final lifecycle event.
export function rememberExitDraft(document: ResumeDocument): boolean {
  try { sessionStorage.setItem(key(document.id), JSON.stringify(document)); return true; }
  catch { return false; /* The ordinary save and browser's unsaved-changes prompt still apply. */ }
}

export function forgetExitDraft(id: string): void {
  try { sessionStorage.removeItem(key(id)); } catch { /* Session storage may be unavailable. */ }
}

export function readExitDraft(id: string, stored?: ResumeDocument): ResumeDocument | undefined {
  try {
    const raw = sessionStorage.getItem(key(id));
    if (!raw) return;
    const draft = validateResumeDocument(JSON.parse(raw));
    if (draft.id !== id || draft.deletedAt) return;
    if (stored) {
      const committed = validateResumeDocument(stored);
      // Validation rebuilds the data in a stable order. A final save may have
      // committed the draft while the browser was already navigating away.
      if (JSON.stringify({ ...committed, updatedAt: draft.updatedAt, revision: draft.revision, deletedAt: undefined }) === JSON.stringify(draft)) {
        forgetExitDraft(id);
        return;
      }
    }
    return draft;
  } catch { return; }
}

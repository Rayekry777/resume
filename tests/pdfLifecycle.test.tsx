// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { switchEditingView } from '../src/lib/markdown';
import { validateResumeDocument } from '../src/lib/storage';
import type { ResumeDocument } from '../src/model';
import { useResumePdf, type ResumePdfState } from '../src/pdf/useResumePdf';
import { createResume } from '../src/sample';

class PdfWorker {
  static current: PdfWorker;
  constructor() { PdfWorker.current = this; }
  requests: { generation: number; document: ResumeDocument }[] = [];
  onmessage?: (event: { data: unknown }) => void;
  postMessage(request: typeof this.requests[number]) { this.requests.push(request); }
  finish(index: number, blob: Blob) {
    this.onmessage?.({ data: { type: 'result', generation: this.requests[index].generation, blob, pageCount: 1 } });
  }
  terminate() {}
}
let root: Root;
let state: ResumePdfState;
function Probe({ resume }: { resume: ResumeDocument }) {
  state = useResumePdf(resume);
  return null;
}
const render = (resume: ResumeDocument) => act(async () => root.render(<Probe resume={resume}/>));
const debounce = () => act(async () => { await vi.advanceTimersByTimeAsync(300); });
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('Worker', PdfWorker);
  root = createRoot(document.createElement('div'));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('uses one PDF generation for an autosave, a switch to source, a subview change and a switch back', async () => {
  const original = createResume('frontend-pro');
  await render(original);
  await debounce();
  const worker = PdfWorker.current;
  const pdf = new Blob(['original PDF']);
  await act(async () => worker.finish(0, pdf));
  const saved = validateResumeDocument({ ...structuredClone(original), revision: 2, updatedAt: Date.now() });
  const markdown = switchEditingView(saved);
  for (const next of [saved, markdown, { ...markdown, markdownView: 'edit' as const }, switchEditingView(markdown)]) {
    await render(next);
    await debounce();
  }
  expect(worker.requests).toHaveLength(1);
  expect(state.blob).toBe(pdf);
});

it('debounces typing and rejects obsolete replies after an edit or document switch', async () => {
  const original = createResume('neat');
  await render(original);
  await debounce();
  const worker = PdfWorker.current;
  const first = new Blob(['original']);
  await act(async () => worker.finish(0, first));
  expect(state.blob).toBe(first);
  for (const name of ['张','张明','张明宇']) {
    await render({ ...original, profile: { ...original.profile, name } });
    expect(state.blob).toBe(null);
    expect(state.previewBlob).toBe(first);
  }
  await debounce();
  expect(worker.requests).toHaveLength(2);
  expect(worker.requests[1].document.profile.name).toBe('张明宇');
  await render({ ...original, id: 'another-document', profile: { ...original.profile, name: '李明' } });
  await act(async () => worker.finish(1, new Blob(['stale'])));
  expect(state.blob).toBe(null);
  expect(state.previewBlob).toBe(null);
  await debounce();
  const current = new Blob(['other document']);
  await act(async () => worker.finish(2, current));
  expect(state.blob).toBe(current);
});

it('omits hidden sections and raw drafts from worker messages and invalidates the PDF when they become visible', async () => {
  const original = createResume('neat');
  const hidden = { ...original.sections[0], id: 'private-draft', visible: false };
  const paper = { ...original, presentationMode: 'visual' as const, sections: [...original.sections, hidden] };
  await render(paper);
  await debounce();
  const worker = PdfWorker.current;
  for (const title of ['隐藏草稿甲', '隐藏草稿乙']) {
    await render({ ...paper, markdownSource: title, sections: [...original.sections, { ...hidden, title }] });
    await debounce();
  }
  expect(worker.requests).toHaveLength(1);
  expect(worker.requests[0].document.sections).toEqual(original.sections);
  expect(worker.requests[0].document.markdownSource).toBeUndefined();
  await render({ ...paper, sections: [...original.sections, { ...hidden, visible: true }] });
  await debounce();
  expect(worker.requests).toHaveLength(2);
});

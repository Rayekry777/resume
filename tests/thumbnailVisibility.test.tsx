// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import TemplateThumbnail from '../src/components/TemplateThumbnail';
import { getTemplate } from '../src/templates';
import { createResume } from '../src/sample';
import { validateResumeDocument } from '../src/lib/storage';

const { hash, generate } = vi.hoisted(() => ({
  hash: vi.fn(async () => 'content hash'),
  generate: vi.fn(() => ({ promise: Promise.resolve(new Blob(['image'])), cancel() {} })),
}));
vi.mock('../src/pdf/resumeThumbnail', () => ({ coverCacheKey: hash, requestResumeThumbnail: generate }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keys and generates covers only for visible cards and reuses the image across cloned autosaves', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('URL', class extends URL { static createObjectURL = () => 'blob:cover'; static revokeObjectURL = vi.fn(); });
  const callbacks: ((visible: boolean) => void)[] = [];
  class Observer {
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { callbacks.push(visible => callback([{ isIntersecting: visible }])); }
    observe() {} disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', Observer);
  const host = document.createElement('div'), root = createRoot(host);
  const papers = Array.from({ length: 10 }, () => createResume('neat', true));
  const template = getTemplate('neat');
  const grid = (resumes: typeof papers) => resumes.map(doc => <TemplateThumbnail key={doc.id} template={template} document={doc}/>);
  try {
    await act(async () => root.render(grid(papers)));
    expect(hash).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    await act(async () => callbacks[2](true));
    await vi.waitFor(() => expect(host.querySelector('img')).not.toBeNull());
    expect(hash).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledOnce();
    await act(async () => root.render(grid(papers.map(doc => validateResumeDocument({ ...structuredClone(doc), revision: 2 })))));
    expect(hash).toHaveBeenCalledOnce();
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:cover');
  } finally {
    await act(async () => root.unmount());
  }
});

it('uses the shared cover file for both catalog aliases', () => {
  for (const [alias, canonical] of [['md-generous', 'elegant'], ['md-graduate-steady', 'steady']]) {
    const html = renderToStaticMarkup(<TemplateThumbnail template={{ ...getTemplate(canonical), id: alias }}/>);
    expect(html).toContain('template-previews/' + canonical + '.webp');
  }
});

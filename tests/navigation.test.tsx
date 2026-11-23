// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import App from '../src/App';
import { waitForReact } from './waitForReact';
import type ResumeEditor from '../src/components/ResumeEditor';
import { rememberExitDraft } from '../src/lib/exitDraft';
import * as storage from '../src/lib/storage';
import { createResume } from '../src/sample';

vi.mock('../src/pwa/PwaStatus', () => ({ default: () => null }));
vi.mock('../src/components/TemplateThumbnail', () => ({ default: () => null }));
vi.mock('../src/components/ResumeEditor', () => ({
  default: ({ document, onTemplates, onUpdate }: ComponentProps<typeof ResumeEditor>) =>
    <section data-editor={document.id}><output>{document.title}</output>
      <button onClick={onTemplates}>选择风格</button>
      <button onClick={()=>onUpdate(d=>({...d,title:'刷新前的最后一次输入'}))}>输入</button>
    </section>,
}));

let root: Root;
let container: HTMLDivElement;
const click = async (selector: string) => act(async () => {
  const target = container.querySelector<HTMLButtonElement>(selector);
  expect(target).toBeTruthy();target!.click();
});
const editor = () => container.querySelector<HTMLElement>('[data-editor]');
async function mount(hash: string) {
  history.replaceState(null,'',hash);
  root=createRoot(container);
  await act(async()=>root.render(<App/>));
  await waitForReact(()=>expect(container.querySelector('.app-interactive')).toBeTruthy());
}
async function changeHash(hash: string) {
  await act(async()=>{
    history.replaceState(null,'',hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('scrollTo',()=>{});
  sessionStorage.clear();
  container = document.createElement('div');document.body.appendChild(container);
});
afterEach(async()=>{
  await act(async()=>root.unmount());
  container.remove();history.replaceState(null,'','#/');
  vi.restoreAllMocks();vi.unstubAllGlobals();
});

it('flushes edits before browser navigation, closes old dialogs and avoids redundant library reads', async()=>{
  const saved=await storage.saveResume(createResume());
  await mount('#/edit/'+saved.id);
  await waitForReact(()=>expect(editor()).toBeTruthy());
  const bulkReads=vi.spyOn(IDBObjectStore.prototype,'getAll');
  await click('[data-editor] button:last-child');
  await click('[data-editor] button:first-of-type');
  expect(container.querySelector('[role="dialog"]')).toBeTruthy();
  await changeHash('#/templates');
  await waitForReact(()=>expect(editor()).toBeNull());
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect((await storage.getResume(saved.id))?.title).toBe('刷新前的最后一次输入');
  expect(bulkReads).not.toHaveBeenCalled();
  await changeHash('#/edit/does-not-exist');
  await waitForReact(()=>expect(location.hash).toBe('#/templates'));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('备份');
});

it('keeps the editor URL and draft when going back fails to save, then recovers through a reload', async()=>{
  const saved=await storage.saveResume(createResume());
  const hash='#/edit/'+saved.id;
  await mount(hash);
  await waitForReact(()=>expect(editor()).toBeTruthy());
  const fail=vi.spyOn(storage,'saveResume').mockRejectedValue(new Error('存储暂不可用'));
  await click('[data-editor] button:last-child');
  await changeHash('#/');
  await waitForReact(()=>expect(location.hash).toBe(hash));
  expect(editor()?.textContent).toContain('刷新前的最后一次输入');
  await act(async()=>{window.dispatchEvent(new Event('beforeunload',{cancelable:true}));});
  expect(sessionStorage.length).toBe(1);
  await act(async()=>root.unmount());
  fail.mockRestore();
  await mount(hash);
  await waitForReact(async()=>expect((await storage.getResume(saved.id))?.title).toBe('刷新前的最后一次输入'));
  expect(sessionStorage.length).toBe(0);
  expect((await storage.getSnapshots(saved.id))).toHaveLength(1);
});

it('recovers dirty changes as a new draft after another tab trashes the original', async()=>{
  const saved=await storage.saveResume(createResume());
  rememberExitDraft({...saved,title:'离开页面时的编辑'});
  await storage.deleteResume(saved.id,saved.revision);
  await mount('#/edit/'+saved.id);
  await waitForReact(()=>expect(editor()).toBeTruthy());
  const newId=editor()!.dataset.editor!;
  expect(newId).not.toBe(saved.id);
  await waitForReact(async()=>expect((await storage.getResume(newId))?.title).toBe('离开页面时的编辑（恢复草稿）'));
  expect((await storage.getResume(saved.id))?.deletedAt).toBeTruthy();
  expect(sessionStorage.length).toBe(0);
});

it('discards an already committed exit copy without another revision', async()=>{
  const saved=await storage.saveResume(createResume());
  rememberExitDraft({...saved,revision:saved.revision-1,updatedAt:saved.updatedAt-1});
  await mount('#/edit/'+saved.id);
  await waitForReact(()=>expect(editor()).toBeTruthy());
  expect(sessionStorage.length).toBe(0);
  expect((await storage.getResume(saved.id))?.revision).toBe(saved.revision);
});

it('allows one create transaction from two quick submissions', async()=>{
  await mount('#/');
  const initial=(await storage.loadResumes(true)).length;
  const button=container.querySelector<HTMLButtonElement>('[data-testid="new-resume"]')!;
  await act(async()=>{button.click();button.click();});
  await waitForReact(()=>expect(editor()).toBeTruthy());
  expect(await storage.loadResumes(true)).toHaveLength(initial+1);
});

it('keeps custom typography when the user chooses their already active design', async()=>{
  const doc=createResume('neat');
  doc.layout={...doc.layout,fontSize:17,sectionGap:22,accent:'#654321'};
  const saved=await storage.saveResume(doc);
  await mount('#/edit/'+doc.id);
  await waitForReact(()=>expect(editor()).toBeTruthy());
  await click('[data-editor] button:first-of-type');
  await click('.reference-drawer-cover[aria-pressed="true"]');
  await changeHash('#/');
  await waitForReact(()=>expect(editor()).toBeNull());
  expect((await storage.getResume(doc.id))?.layout).toEqual(saved.layout);
  expect((await storage.getResume(doc.id))?.revision).toBe(saved.revision);
});

it('returns a template preview to its originating drawer page and title', async()=>{
  const saved=await storage.saveResume(createResume());
  await mount('#/edit/'+saved.id);
  await waitForReact(()=>expect(editor()).toBeTruthy());
  await click('[data-editor] button:first-of-type');
  await click('.reference-drawer-pagination [aria-label="第3页"]');
  const title=container.querySelector<HTMLButtonElement>('.reference-drawer-caption h3 button')!;
  title.focus();
  await act(async()=>title.click());
  expect(container.querySelector('[aria-label="切换模板风格"]')?.closest('[inert]')).toBeTruthy();
  await click('.template-preview-modal [aria-label="关闭弹窗"]');
  expect(container.querySelector('.reference-drawer-pagination [aria-current="page"]')?.textContent).toBe('3');
  expect(document.activeElement).toBe(title);
});

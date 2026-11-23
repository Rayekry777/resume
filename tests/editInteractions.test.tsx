// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import MarkdownEditorPane from '../src/components/MarkdownEditorPane';
import RichTextEditor from '../src/components/RichTextEditor';
import ResumeEditor from '../src/components/ResumeEditor';
import { parseMarkdown, switchEditingView } from '../src/lib/markdown';
import { analyzeMarkdownSource } from '../src/lib/markdownSource';
import { getResume, sanitizeRichText, saveResume } from '../src/lib/storage';
import type { ResumeDocument, RichNode } from '../src/model';
import { createResume } from '../src/sample';

vi.mock('../src/pdf/useResumePdf', () => ({ useResumePdf: () => ({ blob: null, error: null, loading: false, pageCount: 0 }) }));
vi.mock('../src/pdf/PdfPreview', () => ({ default: () => null }));
vi.mock('../src/pdf/export', () => ({ pdfSavePicker: () => undefined, pdfFilename: (title: string) => title + '.pdf', downloadPngZip: vi.fn() }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function clickButton(scope: Element, label: string) {
  const button = [...scope.querySelectorAll('button')].find(button => (button.ariaLabel ?? button.textContent) === label);
  expect(button, label).toBeTruthy();
  return act(async () => button!.click());
}

it('edits Markdown through the module drawer, jumps in both views and opens the saved order from IndexedDB', async () => {
  const original = parseMarkdown('\uFEFF@[name](测试)\r\n:::skill\r\n保留这段  \r\n:::').document;
  let latest = original;
  function Harness({ initial = original }: { initial?: ResumeDocument }) {
    const [doc, setDoc] = useState<ResumeDocument>(initial);
    const [open, setOpen] = useState(true);
    latest = doc;
    return <><button onClick={() => setOpen(true)}>打开模块栏</button><MarkdownEditorPane
      document={doc} onUpdate={setDoc} onChoosePhoto={() => {}} syncScroll={false}
      modulesOpen={open} onCloseModules={() => setOpen(false)}/></>;
  }
  await act(async () => root.render(<Harness/>));
  const dialog = () => host.querySelector('[role=dialog]')!;
  await clickButton(dialog(), '专业技能');
  expect(document.activeElement?.getAttribute('data-md-block')).toBe('0');
  await clickButton(host, '源码模式');
  await clickButton(host, '打开模块栏');
  await act(async () => dialog().querySelector('summary')!.click());
  await clickButton(dialog(), '项目经历');
  const textarea = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown 源码"]')!;
  expect(textarea.selectionStart).toBe(textarea.value.indexOf(':::project'));
  expect(textarea).toBe(document.activeElement);
  await clickButton(host, '打开模块栏');
  await clickButton(dialog(), '上移项目经历');
  expect(analyzeMarkdownSource(latest.markdownSource!).blocks.map(block => block.type)).toEqual(['project', 'skill']);
  const saved = await saveResume(latest);
  const reopened = await getResume(saved.id);
  expect(reopened?.markdownSource).toBe(latest.markdownSource);
  expect(reopened?.markdownView).toBe('source');
  sessionStorage.clear();
  await act(async () => root.render(<Harness key="reopened" initial={reopened!}/>));
  expect(host.querySelector('textarea[aria-label="Markdown 源码"]')).toBeTruthy();
  const restoredButtons = [...dialog().querySelectorAll('.md-drawer-jump')].map(button => button.textContent);
  expect(restoredButtons).toEqual(['基本信息', '项目经历', '专业技能']);
  await clickButton(dialog(), '删除项目经历');
  expect(analyzeMarkdownSource(latest.markdownSource!).blocks.map(block => block.type)).toEqual(['skill']);
  expect(latest.markdownSource).toContain('保留这段  \r\n:::');
});

it('opens the editable source in one click from either kind of template and restores the form with the same paper', async () => {
  const ordinary = createResume('graduate');
  const native = switchEditingView(parseMarkdown('@[template](md-graduate-business)\n@[name](姓名)\n:::skill\n混合 TypeScript\n:::').document);
  let latest: ResumeDocument;
  function Harness({ initial }: { initial: ResumeDocument }) {
    const [doc, setDoc] = useState(initial);
    latest = doc;
    return <ResumeEditor document={doc} onUpdate={setDoc} onBack={() => {}} onTemplates={() => {}}
      onBackup={() => {}} onMarkdown={() => {}} onHistory={() => {}} onToast={() => {}} saveState="saved"/>;
  }
  for (const document of [ordinary, native]) {
    await act(async () => root.render(<Harness key={document.id} initial={document}/>));
    await clickButton(host, '切换到 Markdown 源码');
    const source = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown 源码"]')!;
    expect(source.value).toContain(document.profile.name);
    const name = '源码修改姓名';
    const changed = source.value.replace(`@[name](${document.profile.name})`, `@[name](${name})`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(source, changed);
      source.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(latest!.profile.name).toBe(name);
    expect(latest!.layout).toEqual(document.layout);
    await clickButton(host, '切换到表单编辑');
    expect(host.querySelector('textarea[aria-label="Markdown 源码"]')).toBeNull();
    expect(latest!).toMatchObject({ templateId: document.templateId, layout: document.layout, editorMode: 'visual' });
  }
});

it('keeps the selection and composition across a saved rich-text echo but applies an external change', async () => {
  let value: RichNode = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲乙丙丁' }] }] };
  function paint() {
    return act(async () => root.render(<RichTextEditor value={value} onChange={next => { value = next; }}/>));
  }
  await paint();
  const editable = host.querySelector<HTMLElement & { editor: Editor }>('.ProseMirror')!;
  const editor = editable.editor;
  await act(async () => {
    editor.commands.setTextSelection(3);
    editor.commands.insertContent('中');
  });
  const saved = sanitizeRichText(value);
  const before = editor.state.doc;
  value = saved;
  await paint();
  expect(editor.state.doc).toBe(before);
  expect(editor.state.selection.from).toBe(4);
  await act(async () => {
    editable.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'wen' }));
  });
  expect(editor.view.composing).toBe(true);
  value = structuredClone(saved);
  await paint();
  expect(editor.view.composing).toBe(true);
  expect(editor.state.selection.from).toBe(4);
  await act(async () => {
    editable.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '文' }));
    editor.commands.insertContent('文');
  });
  expect(editor.getText()).toBe('甲乙中文丙丁');
  value = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '恢复的版本' }] }] };
  await paint();
  expect(editor.getText()).toBe('恢复的版本');
});

// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { createResume } from '../src/sample';
import { getSetting, saveResume, setSetting } from '../src/lib/storage';
import App from '../src/App';
import { waitForReact } from './waitForReact';

vi.mock('../src/pwa/PwaStatus', () => ({ default: () => null }));
vi.mock('../src/components/TemplateThumbnail', () => ({ default: () => null }));
vi.mock('../src/components/ResumeEditor', () => ({
  default: ({ onBackup, onBack }: { onBackup: () => void; onBack: () => void }) =>
    <><button onClick={onBackup}>导出当前简历</button><button onClick={onBack}>我的简历</button></>,
}));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('clears the library backup reminder only after exporting all resumes', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('scrollTo', () => {});
  const objectURL = vi.fn(() => 'blob:backup');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: objectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
  const downloaded = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const first = await saveResume(createResume());
  await saveResume(createResume());
  const previous = Date.now() - 8 * 86400000;
  await setSetting('lastBackupAt', previous);
  history.replaceState(null, '', '#/edit/' + first.id);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const button = (text: string) => Array.from(container.querySelectorAll('button')).find(button => button.textContent?.trim() === text);
  async function click(label: string) {
    await waitForReact(() => expect(button(label)).toBeTruthy());
    await act(async () => { button(label)!.click(); });
  }
  try {
    await act(async () => root.render(<App/>));
    await click('导出当前简历');
    await waitForReact(() => expect(downloaded).toHaveBeenCalledTimes(1));
    expect(await getSetting('lastBackupAt')).toBe(previous);
    await click('我的简历');
    await waitForReact(() => expect(container.textContent).toContain('有更新待备份'));
    expect(container.querySelector('button[aria-label="简历首页"]')?.textContent).toBe('简历');
    await click('备份全部');
    await waitForReact(async () => expect(await getSetting<number>('lastBackupAt')).toBeGreaterThan(previous));
    expect(downloaded).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain('有更新待备份');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    history.replaceState(null, '', '#/');
  }
});

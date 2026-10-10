import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import type { DesktopApi } from '../../src/shared/contracts';

const bridge = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }));
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: bridge.expose }, ipcRenderer: { invoke: bridge.invoke } }));

type WebBridge = Required<Pick<DesktopApi, 'fetchWebExtraction' | 'cancelWebExtraction' | 'previewPastedExtraction'>>;

it('网页与粘贴桥接仅开放明确命令，保留操作身份及主进程回执', async () => {
  await import('../../src/preload/index');
  const api = bridge.expose.mock.calls[0][1] as WebBridge;
  const request = { workId: randomUUID(), operationId: randomUUID(), url: 'https://article.example.com/read' };
  const preview = { token: randomUUID(), workId: request.workId, format: 'web' };
  bridge.invoke.mockResolvedValue({ ok: true, data: preview });
  expect(await api.fetchWebExtraction(request)).toEqual(preview);
  expect(bridge.invoke).toHaveBeenLastCalledWith('rainsoul:command', 'fetchWebExtraction', request);
  bridge.invoke.mockResolvedValue({ ok: true, data: undefined });
  await api.cancelWebExtraction(request.operationId);
  expect(bridge.invoke).toHaveBeenLastCalledWith('rainsoul:command', 'cancelWebExtraction', { operationId: request.operationId });
  const paste = { workId: request.workId, title: '粘贴素材', text: '保留原文段落\n第二段' };
  bridge.invoke.mockResolvedValue({ ok: true, data: { ...preview, format: 'paste' } });
  expect(await api.previewPastedExtraction(paste)).toEqual({ ...preview, format: 'paste' });
  expect(bridge.invoke).toHaveBeenLastCalledWith('rainsoul:command', 'previewPastedExtraction', paste);
  bridge.invoke.mockResolvedValue({ ok: false, message: '来源已取消' });
  await expect(api.fetchWebExtraction(request)).rejects.toThrow('来源已取消');
  await expect(api.previewPastedExtraction(paste)).rejects.toThrow('来源已取消');
  await expect(api.cancelWebExtraction(request.operationId)).rejects.toThrow('来源已取消');
});

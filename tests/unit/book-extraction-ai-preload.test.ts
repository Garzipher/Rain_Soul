import { expect, it, vi } from 'vitest';
import type { DesktopApi } from '../../src/shared/contracts';

const bridge = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn() }));
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: bridge.expose }, ipcRenderer: { invoke: bridge.invoke } }));

it('拆书AI四项受限IPC保留请求身份与回执，不暴露路径或凭据', async () => {
  await import('../../src/preload/index');
  const api = bridge.expose.mock.calls[0][1] as DesktopApi;
  const request = { workId: crypto.randomUUID(), token: crypto.randomUUID(), segmentIds: [crypto.randomUUID()], permissionConfirmed: true as const };
  const prepared = { confirmationToken: '授权token', requestHash: 'a'.repeat(64), confirmed: true };
  bridge.invoke.mockResolvedValue({ ok: true, data: { status: 'ready' } });
  await api.prepareBookExtractionAi(request);
  expect(bridge.invoke).toHaveBeenLastCalledWith('rainsoul:command', 'prepareBookExtractionAi', request);
  await api.executeBookExtractionAi(prepared);
  expect(bridge.invoke).toHaveBeenLastCalledWith('rainsoul:command', 'executeBookExtractionAi', prepared);
  const lookup = { workId: request.workId, previewToken: request.token, requestHash: prepared.requestHash };
  expect(await api.getBookExtractionAiResult(lookup)).toEqual({ status: 'ready' });
  expect(bridge.invoke).toHaveBeenLastCalledWith('rainsoul:command', 'getBookExtractionAiResult', lookup);
  await api.cancelBookExtractionAi(prepared.confirmationToken);
  expect(bridge.invoke).toHaveBeenLastCalledWith('rainsoul:command', 'cancelBookExtractionAi', { confirmationToken: prepared.confirmationToken });
  bridge.invoke.mockResolvedValue({ ok: false, message: '授权已过期' });
  await expect(api.executeBookExtractionAi(prepared)).rejects.toThrow('授权已过期');
});

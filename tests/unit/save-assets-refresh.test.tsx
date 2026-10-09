// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { useWritingSession } from '../../src/renderer/hooks/use-writing-session';
import { createStructureAdapter } from './renderer-structure-adapter';
import { emptyDocument } from '../../src/shared/document';
it('删除证据段落后保存回执同步失效资产，不清除新的作者草稿', async () => {
  const adapter = createStructureAdapter();
  let work = await adapter.api.createWork('证据测试');
  try {
    const document = emptyDocument(); document.content[0].content = [{ type: 'text', text: '旧钥匙' }];
    await adapter.api.saveChapter(work.id, work.chapters[0].id, '开篇', document, work.revision, randomUUID());
    work = await adapter.api.openWork(work.id);
    work = await adapter.api.manageAssets({ workId: work.id, expectedRevision: work.revision, operationId: randomUUID(), action: { type: 'createForeshadow', name: '钥匙' } });
    work = await adapter.api.manageAssets({ workId: work.id, expectedRevision: work.revision, operationId: randomUUID(), action: { type: 'addEvidence', foreshadowId: work.assets!.foreshadows[0].id, kind: '埋设', chapterId: work.chapters[0].id, paragraphId: document.content[0].attrs.id, excerpt: '旧钥匙' } });
    expect(work.assets!.evidence[0].valid).toBe(true);
    const view = renderHook(() => useWritingSession(adapter.api, work, work.chapters[0].id, updated => { work = updated; }, { beforeClose: async () => {}, isBlocked: () => false }));
    await waitFor(() => expect(view.result.current.draft).not.toBeNull());
    await act(async () => { view.result.current.updateDocument(emptyDocument()); });
    await act(async () => { await view.result.current.flush(); });
    expect(work.assets!.evidence[0].valid).toBe(false);
    expect(work.assets!.evidence[0].invalidReason).toContain('段落');
    expect(view.result.current.draft!.document.content[0].content).toEqual([]);
    view.unmount();
  } finally { adapter.dispose(); }
});

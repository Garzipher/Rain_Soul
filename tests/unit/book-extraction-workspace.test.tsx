// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BookExtractionWorkspace } from '../../src/renderer/components/book-extraction-workspace';
import type { WorkDetail, DesktopApi } from '../../src/shared/contracts';
import type { BookExtractionApi, BookExtractionPreview } from '../../src/shared/book-extraction';
import type { BookExtractionAiApi } from '../../src/shared/book-extraction-ai';
import { freezeSource } from '../../src/main/freeze-source';
import type { ExtractionDraftRecovery } from '../../src/shared/extraction-draft';
afterEach(cleanup);
function setup(extraSegments = 0, restore: boolean | 'broken' | 'batches' = false, capability: 'enabled' | 'disabled' | 'failure' = 'disabled') {
  const categoryId = crypto.randomUUID(), work: WorkDetail = { id: crypto.randomUUID(), title: '当前作品', revision: 1, chapters: [], volumes: [], deletedItems: [],
    assets: { categories: [{ id: categoryId, name: '景物描写', parentId: null, sortOrder: 0, systemKey: null, deletedAt: null }], tags: [], knowledge: [], outlines: [], foreshadows: [], evidence: [], styleProfiles: [], chapterStyles: [], defaultStyleId: null } };
  const preview: BookExtractionPreview = { token: crypto.randomUUID(), workId: work.id, filename: '优秀作品.txt', fileHash: 'a'.repeat(64), format: 'txt', warnings: [], segments: [
    { id: crypto.randomUUID(), chapterTitle: '开篇', chapterIndex: 1, paragraphIndex: 1, text: '<script>优美的雨景</script>' },
    { id: crypto.randomUUID(), chapterTitle: '开篇', chapterIndex: 1, paragraphIndex: 2, text: '没有审核的内容' },
  ] };
  for (let index = 0; index < extraSegments; index++) preview.segments.push({ id: crypto.randomUUID(), chapterTitle: '后章', chapterIndex: 2, paragraphIndex: index + 1, text: `后章第${index + 1}段` });
  const aiPrepared = { confirmationToken: crypto.randomUUID(), requestHash: 'a'.repeat(64), expiresAt: Date.now() + 10000, service: '测试云服务', model: '测试模型', scopeLabel: '所选素材', previewText: '原始段落', paragraphIds: [preview.segments[0].id], billingHint: '可能产生费用', estimatedInputTokens: 80, maxOutputTokens: 4096 };
  const aiResult = { workId: work.id, previewToken: preview.token, requestHash: aiPrepared.requestHash, rawText: '原始回答', suggestions: [{ segmentId: preview.segments[0].id, excerpt: '优美的雨景', categoryId, tagIds: [], technique: '声音与景物结合', usage: '适合夜景', exercise: '用三句话描写雨夜' }] };
  const api: BookExtractionApi & BookExtractionAiApi & Pick<DesktopApi, 'fetchWebExtraction' | 'cancelWebExtraction' | 'previewPastedExtraction'> & { discardExtractionDraft?: (workId: string, token: string) => Promise<void> } = {
    getWebRenderCapability: vi.fn(async () => { if (capability === 'failure') throw new Error('资格查询失败'); return { enabled: capability === 'enabled', policyVersion: 1 as const, message: capability === 'enabled' ? '当前构建已验收' : '当前构建未通过受限渲染验收' }; }),
    discardExtractionDraft: vi.fn(async () => {}),
    fetchWebExtraction: vi.fn(async () => ({ ...preview, format: 'web' as const })),
    cancelWebExtraction: vi.fn(async () => {}), previewPastedExtraction: vi.fn(async () => ({ ...preview, format: 'paste' as const })),
    prepareBookExtractionAi: vi.fn(async () => aiPrepared),
    executeBookExtractionAi: vi.fn(async () => aiResult),
    getBookExtractionAiResult: vi.fn(async () => ({ status: 'ready' as const, result: aiResult })), cancelBookExtractionAi: vi.fn(async () => {}),
    chooseBookExtraction: vi.fn(async () => preview), confirmBookExtraction: vi.fn(async () => ({ ...work, revision: 2 })), cancelBookExtraction: vi.fn(async () => {}) };
  if (restore) {
    const source = freezeSource({ kind: 'txt', title: preview.filename, rawBytes: Buffer.from('原稿'), segments: preview.segments.map(segment => ({ text: segment.text })) });
    source.segments.forEach((segment, index) => { segment.id = preview.segments[index].id; });
    api.readExtractionDraft = vi.fn(async (): Promise<ExtractionDraftRecovery> => ({ preview, draft: { schemaVersion: 1, taskId: crypto.randomUUID(), workId: work.id, previewToken: preview.token, source, batches: restore === 'batches' ? [{ id: crypto.randomUUID(), requestHash: aiResult.requestHash, segmentIds: [preview.segments[0].id], status: 'ready', categoryIds: [categoryId], tagIds: [], suggestions: aiResult.suggestions, rawText: aiResult.rawText }] : [], committing: null,
      reviews: [{ segmentId: preview.segments[0].id, body: '已入库摘录', categoryId, tagIds: [], status: 'committed', annotation: { technique: '旧写法', usage: '', exercise: '' } },
        { segmentId: preview.segments[1].id, body: '尚未入库的审核草稿', categoryId, tagIds: [], status: 'approved' }] } }));
    api.saveExtractionReview = vi.fn(async () => (await api.readExtractionDraft!(work.id))!.draft);
    if (restore === 'broken') vi.mocked(api.readExtractionDraft).mockRejectedValue(new Error('草稿损坏'));
  }
  const onClose = vi.fn(), onCommitted = vi.fn(), onDirtyChange = vi.fn();
  const view = render(<BookExtractionWorkspace key={work.id} work={work} api={api} onClose={onClose} onCommitted={onCommitted} onDirtyChange={onDirtyChange} />);
  return { api, work, preview, onClose, onCommitted, onDirtyChange, view };
}
it('默认零选择；只审核选中段落和权限后入库，正文纯文本展示，编辑后须重新审核', async () => {
  const { api, work, onCommitted, onDirtyChange } = setup();
  fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  await screen.findByRole('textbox', { name: '摘选内容 1' });
  expect(screen.getByRole('button', { name: '确认入库（0）' })).toHaveProperty('disabled', true);
  expect(document.querySelector('script')).toBeNull();
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过段落 1' }));
  fireEvent.change(screen.getByRole('textbox', { name: '摘选内容 1' }), { target: { value: '自己的仿写笔记' } });
  expect(screen.getByRole('checkbox', { name: '审核通过段落 1' })).toHaveProperty('checked', false);
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过段落 1' }));
  expect(screen.getByRole('button', { name: '确认入库（1）' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('checkbox', { name: '确认有权使用摘选内容' }));
  fireEvent.click(screen.getByRole('button', { name: '确认入库（1）' }));
  await waitFor(() => expect(onCommitted).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 })));
  expect(api.confirmBookExtraction).toHaveBeenCalledWith(expect.objectContaining({ workId: work.id, permissionConfirmed: true, items: [expect.objectContaining({ body: '自己的仿写笔记' })] }));
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  expect(screen.getByRole('textbox', { name: '摘选内容 2' })).toHaveProperty('value', '没有审核的内容');
  expect(screen.getByRole('checkbox', { name: '审核通过段落 1' }).closest('fieldset')).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: '确认入库（0）' })).toHaveProperty('disabled', true);
});
it.each(['disabled', 'failure'] as const)('受限渲染资格%s时禁用并解释原因，静态入口可用且不联网', async capability => {
  const { api } = setup(0, false, capability);
  fireEvent.click(screen.getByRole('button', { name: '网页文章' }));
  fireEvent.change(screen.getByRole('textbox', { name: '公开网页地址' }), { target: { value: 'https://article.example.com/read' } });
  await screen.findByText(capability === 'failure' ? /资格查询失败/ : /当前构建未通过受限渲染验收/);
  expect(screen.getByRole('button', { name: '受限渲染并预览' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: '获取并预览' })).toHaveProperty('disabled', false);
  expect(api.fetchWebExtraction).not.toHaveBeenCalled();
});
it('受限渲染每次确认当前网址、脚本、限制和40秒，取消零请求且重试重新确认', async () => {
  const { api, work } = setup(0, false, 'enabled');
  vi.mocked(api.fetchWebExtraction!).mockRejectedValueOnce(new Error('正文脚本失败，请改用粘贴或本地文件'));
  fireEvent.click(screen.getByRole('button', { name: '网页文章' }));
  fireEvent.change(screen.getByRole('textbox', { name: '公开网页地址' }), { target: { value: 'https://article.example.com/first' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '受限渲染并预览' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '受限渲染并预览' }));
  const dialog = await screen.findByRole('dialog', { name: '确认受限网页渲染' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' }));
  expect(dialog.textContent).toContain('https://article.example.com/first'); expect(dialog.textContent).toContain('页面脚本');
  expect(dialog.textContent).toContain('40 秒'); expect(dialog.textContent).toContain('登录'); expect(dialog.textContent).toContain('验证码');
  expect(dialog.textContent).toContain('跨站'); expect(dialog.textContent).toContain('翻页');
  expect(api.fetchWebExtraction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(api.fetchWebExtraction).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('textbox', { name: '公开网页地址' }), { target: { value: 'https://article.example.com/second' } });
  fireEvent.click(screen.getByRole('button', { name: '受限渲染并预览' }));
  expect((await screen.findByRole('dialog', { name: '确认受限网页渲染' })).textContent).toContain('https://article.example.com/second');
  fireEvent.click(screen.getByRole('button', { name: '确认渲染' }));
  await screen.findByRole('alert'); expect(api.fetchWebExtraction).toHaveBeenCalledWith({ workId: work.id, operationId: expect.any(String), url: 'https://article.example.com/second', mode: 'restricted-browser' });
  fireEvent.click(screen.getByRole('button', { name: '受限渲染并预览' }));
  await screen.findByRole('dialog', { name: '确认受限网页渲染' }); expect(api.fetchWebExtraction).toHaveBeenCalledTimes(1);
});
it('确认期间网址改变必须重新确认，当前审核草稿禁止被网页入口覆盖', async () => {
  const { api } = setup(0, false, 'enabled');
  fireEvent.click(screen.getByRole('button', { name: '网页文章' }));
  fireEvent.change(screen.getByRole('textbox', { name: '公开网页地址' }), { target: { value: 'https://article.example.com/first' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '受限渲染并预览' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '受限渲染并预览' })); await screen.findByRole('dialog', { name: '确认受限网页渲染' });
  fireEvent.change(screen.getByRole('textbox', { name: '公开网页地址' }), { target: { value: 'https://article.example.com/second' } });
  expect(screen.getByRole('button', { name: '确认渲染' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '确认渲染' })); expect(api.fetchWebExtraction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  cleanup(); const recovered = setup(0, true, 'enabled');
  await screen.findByRole('textbox', { name: '摘选内容 2' });
  fireEvent.change(screen.getByRole('textbox', { name: '摘选内容 2' }), { target: { value: '需要保留的审核笔记' } });
  fireEvent.click(screen.getByRole('button', { name: '网页文章' }));
  expect(recovered.api.fetchWebExtraction).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: '摘选内容 2' })).toHaveProperty('value', '需要保留的审核笔记');
});
it('取消受限渲染后迟到结果不能覆盖新的粘贴素材', async () => {
  const { api, preview } = setup(0, false, 'enabled'); let release!: (value: BookExtractionPreview) => void;
  vi.mocked(api.fetchWebExtraction!).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '网页文章' }));
  fireEvent.change(screen.getByRole('textbox', { name: '公开网页地址' }), { target: { value: 'https://article.example.com/read' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '受限渲染并预览' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '受限渲染并预览' })); fireEvent.click(await screen.findByRole('button', { name: '确认渲染' }));
  fireEvent.click(await screen.findByRole('button', { name: '取消获取' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '粘贴正文' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '粘贴正文' }));
  fireEvent.change(screen.getByRole('textbox', { name: '素材标题' }), { target: { value: '新素材' } });
  fireEvent.change(screen.getByRole('textbox', { name: '粘贴原文' }), { target: { value: '新正文' } });
  vi.mocked(api.previewPastedExtraction!).mockResolvedValueOnce({ ...preview, filename: '新素材', format: 'paste' });
  fireEvent.click(screen.getByRole('button', { name: '预览粘贴内容' })); await screen.findByRole('region', { name: '原文阅读' });
  release({ ...preview, filename: '迟到网页', format: 'web' }); await Promise.resolve();
  expect(screen.queryByText(/迟到网页/)).toBeNull(); expect(screen.getByRole('textbox', { name: '来源作品名' })).toHaveProperty('value', '新素材');
});
it('换作品时取消受限任务，迟到结果不成为新作品草稿', async () => {
  const { api, work, preview, view } = setup(0, false, 'enabled'); let release!: (value: BookExtractionPreview) => void;
  vi.mocked(api.fetchWebExtraction!).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '网页文章' }));
  fireEvent.change(screen.getByRole('textbox', { name: '公开网页地址' }), { target: { value: 'https://article.example.com/read' } });
  await waitFor(() => expect(screen.getByRole('button', { name: '受限渲染并预览' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '受限渲染并预览' })); fireEvent.click(await screen.findByRole('button', { name: '确认渲染' }));
  const next = { ...work, id: crypto.randomUUID(), title: '新作品' };
  view.rerender(<BookExtractionWorkspace key={next.id} work={next} api={api} onClose={vi.fn()} onCommitted={vi.fn()} />);
  release({ ...preview, format: 'web' });
  await waitFor(() => expect(api.cancelWebExtraction).toHaveBeenCalledWith(expect.any(String)));
  expect(screen.queryByRole('region', { name: '原文阅读' })).toBeNull();
  expect(screen.getByRole('button', { name: '选择 TXT / DOCX' })).toHaveProperty('disabled', false);
});
it('本机恢复审核草稿和已入库状态，不恢复发送授权；修改后保存独立注释', async () => {
  const { api } = setup(0, true);
  await waitFor(() => expect(screen.getByRole('textbox', { name: '摘选内容 2' })).toHaveProperty('value', '尚未入库的审核草稿'));
  expect(screen.getByRole('checkbox', { name: '确认有权使用摘选内容' })).toHaveProperty('checked', false);
  expect(screen.getByRole('checkbox', { name: '审核通过段落 1' }).closest('fieldset')).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByRole('textbox', { name: '写作手法 2' }), { target: { value: '作者补充的写法' } });
  await waitFor(() => expect(api.saveExtractionReview).toHaveBeenCalledWith(expect.objectContaining({ reviews: expect.arrayContaining([expect.objectContaining({ status: 'pending', annotation: { technique: '作者补充的写法', usage: '', exercise: '' } })]) })));
  expect(api.fetchWebExtraction).not.toHaveBeenCalled(); expect(api.prepareBookExtractionAi).not.toHaveBeenCalled();
});
it('草稿工作区提供已完成AI批次恢复入口，读取本机建议不触发云请求', async () => {
  const { api } = setup(0, 'batches');
  fireEvent.click(await screen.findByRole('button', { name: '查看已保存 AI 批次 1' }));
  expect(await screen.findByText('声音与景物结合')).not.toBeNull();
  expect(screen.getByRole('checkbox', { name: '确认有权使用摘选内容' })).toHaveProperty('checked', false);
  expect(screen.getByRole('button', { name: '带入审核' })).toHaveProperty('disabled', true);
  expect(api.executeBookExtractionAi).not.toHaveBeenCalled(); expect(api.confirmBookExtraction).not.toHaveBeenCalled();
});
it('恢复损坏草稿不会自动覆盖，保存失败阻止返回以保护编辑内容', async () => {
  const broken = setup(0, 'broken');
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '草稿损坏');
  fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  expect(broken.api.chooseBookExtraction).not.toHaveBeenCalled();
  expect(broken.api.saveExtractionReview).not.toHaveBeenCalled();
  cleanup();
  const { api, onClose } = setup(0, true);
  await screen.findByRole('textbox', { name: '摘选内容 2' });
  vi.mocked(api.saveExtractionReview!).mockRejectedValue(new Error('草稿磁盘写入失败'));
  fireEvent.change(screen.getByRole('textbox', { name: '摘选内容 2' }), { target: { value: '必须保留的手工修改' } });
  fireEvent.click(screen.getByRole('button', { name: '返回知识库' }));
  fireEvent.click(screen.getByRole('button', { name: '保存草稿并返回' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '草稿磁盘写入失败');
  expect(onClose).not.toHaveBeenCalled(); expect(api.cancelBookExtraction).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: '摘选内容 2' })).toHaveProperty('value', '必须保留的手工修改');
});
it('更换素材必须确认，只放弃拆文草稿，取消或失败保留当前素材', async () => {
  const { api, work, preview } = setup(0, true);
  await screen.findByRole('textbox', { name: '摘选内容 2' });
  fireEvent.click(screen.getByRole('button', { name: '更换素材' }));
  await screen.findByRole('dialog', { name: '更换拆书素材？' });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(api.discardExtractionDraft).not.toHaveBeenCalled();
  vi.mocked(api.discardExtractionDraft!).mockRejectedValueOnce(new Error('入库回执待核对'));
  fireEvent.click(screen.getByRole('button', { name: '更换素材' }));
  fireEvent.click(screen.getByRole('button', { name: '放弃草稿并更换' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '入库回执待核对');
  expect(screen.getByRole('textbox', { name: '摘选内容 2' })).toHaveProperty('value', '尚未入库的审核草稿');
  fireEvent.click(screen.getByRole('button', { name: '放弃草稿并更换' }));
  await waitFor(() => expect(screen.queryByRole('region', { name: '原文阅读' })).toBeNull());
  expect(api.discardExtractionDraft).toHaveBeenLastCalledWith(work.id, preview.token);
  expect(api.confirmBookExtraction).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '选择 TXT / DOCX' })).toHaveProperty('disabled', false);
});
it('工作区卸载前将500ms内的最后编辑交给本机保存队列', async () => {
  const { api, view } = setup(0, true);
  await screen.findByRole('textbox', { name: '摘选内容 2' });
  fireEvent.change(screen.getByRole('textbox', { name: '摘选内容 2' }), { target: { value: '最后一笔编辑' } });
  view.unmount();
  await waitFor(() => expect(api.saveExtractionReview).toHaveBeenCalledWith(expect.objectContaining({ reviews: expect.arrayContaining([expect.objectContaining({ body: '最后一笔编辑' })]) })));
});
it('未知入库结果可手动核对本机回执，保留未提交修改并解除退出阻塞', async () => {
  const { api, work, onCommitted, onClose } = setup(0, true);
  await screen.findByRole('textbox', { name: '摘选内容 2' });
  fireEvent.change(screen.getByRole('textbox', { name: '摘选内容 2' }), { target: { value: '下一批手工修改' } });
  vi.mocked(api.saveExtractionReview!).mockRejectedValueOnce(new Error('入库回执待核对，不能改写审核内容'));
  const recovered = (await api.readExtractionDraft!(work.id))!;
  vi.mocked(api.readExtractionDraft!).mockResolvedValue({ ...recovered, work: { ...work, revision: 2 } });
  fireEvent.click(screen.getByRole('button', { name: '核对入库回执' }));
  await waitFor(() => expect(onCommitted).toHaveBeenCalledWith(expect.objectContaining({ revision: 2 })));
  expect(screen.getByRole('textbox', { name: '摘选内容 2' })).toHaveProperty('value', '下一批手工修改');
  expect(screen.getByRole('checkbox', { name: '审核通过段落 1' }).closest('fieldset')).toHaveProperty('disabled', true);
  expect(api.fetchWebExtraction).not.toHaveBeenCalled(); expect(api.prepareBookExtractionAi).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '返回知识库' }));
  fireEvent.click(screen.getByRole('button', { name: '保存草稿并返回' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});
it('网页和粘贴入口保留真实主进程预览，阅读与审核为两个区域', async () => {
  const { api, work } = setup(22);
  fireEvent.click(screen.getByRole('button', { name: '网页文章' }));
  fireEvent.change(screen.getByRole('textbox', { name: '公开网页地址' }), { target: { value: 'https://article.example.com/read' } });
  fireEvent.click(screen.getByRole('button', { name: '获取并预览' }));
  await screen.findByRole('region', { name: '原文阅读' });
  expect(api.fetchWebExtraction).toHaveBeenCalledWith(expect.objectContaining({ workId: work.id, url: 'https://article.example.com/read', operationId: expect.any(String) }));
  expect(screen.getByRole('region', { name: '摘选审核' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '原文下一页' }));
  expect(screen.getByText('后章第22段')).toBeTruthy();
  expect(screen.getByRole('textbox', { name: '摘选内容 1' })).toBeTruthy();
});
it('粘贴材料不联网，网页取消忽略晚返回且保留来源选择', async () => {
  const { api, work, preview } = setup();
  let release!: (value: BookExtractionPreview) => void;
  vi.mocked(api.fetchWebExtraction!).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '网页文章' }));
  fireEvent.change(screen.getByRole('textbox', { name: '公开网页地址' }), { target: { value: 'https://article.example.com/read' } });
  fireEvent.click(screen.getByRole('button', { name: '获取并预览' }));
  fireEvent.click(await screen.findByRole('button', { name: '取消获取' }));
  await waitFor(() => expect(api.cancelWebExtraction).toHaveBeenCalledWith(expect.any(String)));
  release({ ...preview, format: 'web' });
  await waitFor(() => expect(screen.queryByRole('region', { name: '原文阅读' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '粘贴正文' }));
  fireEvent.change(screen.getByRole('textbox', { name: '素材标题' }), { target: { value: '雨夜参考' } });
  fireEvent.change(screen.getByRole('textbox', { name: '粘贴原文' }), { target: { value: '第一段\n第二段' } });
  fireEvent.click(screen.getByRole('button', { name: '预览粘贴内容' }));
  await screen.findByRole('region', { name: '原文阅读' });
  expect(api.previewPastedExtraction).toHaveBeenCalledWith({ workId: work.id, title: '雨夜参考', text: '第一段\n第二段' });
  expect(api.fetchWebExtraction).toHaveBeenCalledTimes(1);
});
async function generateAiSuggestion() {
  fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  await screen.findByRole('textbox', { name: '摘选内容 1' });
  fireEvent.click(screen.getByRole('checkbox', { name: '确认有权使用摘选内容' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'AI 分析段落 1' }));
  fireEvent.click(screen.getByRole('button', { name: '准备 AI 推荐' }));
  await screen.findByRole('dialog', { name: '确认 AI 辅助拆书' });
  fireEvent.click(screen.getByRole('button', { name: '确认发送' }));
  await screen.findByRole('button', { name: '带入审核' });
}
it('AI分析选择不预选入库，作者采纳后带入摘录与写法，仍须重新审核', async () => {
  const { api } = setup();
  await generateAiSuggestion();
  expect(screen.getByRole('checkbox', { name: '审核通过段落 1' })).toHaveProperty('checked', false);
  expect(api.confirmBookExtraction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '带入审核' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: '摘选内容 1' })).toHaveProperty('value', '优美的雨景'));
  expect(screen.getByRole('textbox', { name: '写作手法 1' })).toHaveProperty('value', '声音与景物结合');
  expect(screen.getByRole('textbox', { name: '适用场景 1' })).toHaveProperty('value', '适合夜景');
  fireEvent.change(screen.getByRole('textbox', { name: '仿写练习 1' }), { target: { value: '我自己的练习' } });
  expect(screen.getByRole('button', { name: '确认入库（0）' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过段落 1' }));
  fireEvent.click(screen.getByRole('button', { name: '确认入库（1）' }));
  await waitFor(() => expect(api.confirmBookExtraction).toHaveBeenCalledTimes(1));
  expect(api.confirmBookExtraction).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.objectContaining({ body: '优美的雨景', annotation: { technique: '声音与景物结合', usage: '适合夜景', exercise: '我自己的练习' } })] }));
});
it('AI建议不会静默覆盖手工编辑，取消替换保留原稿，确认后清除审核勾选', async () => {
  setup(); await generateAiSuggestion();
  fireEvent.change(screen.getByRole('textbox', { name: '摘选内容 1' }), { target: { value: '我的手工学习笔记' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过段落 1' }));
  fireEvent.click(screen.getByRole('button', { name: '带入审核' }));
  await screen.findByRole('dialog', { name: '替换本段审核内容？' });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.getByRole('textbox', { name: '摘选内容 1' })).toHaveProperty('value', '我的手工学习笔记');
  expect(screen.getByRole('checkbox', { name: '审核通过段落 1' })).toHaveProperty('checked', true);
  fireEvent.click(screen.getByRole('button', { name: '带入审核' }));
  await screen.findByRole('dialog', { name: '替换本段审核内容？' });
  fireEvent.click(screen.getByRole('button', { name: '替换并重新审核' }));
  await waitFor(() => expect(screen.getByRole('checkbox', { name: '审核通过段落 1' })).toHaveProperty('checked', false));
});
it('替换确认期间配置变化，确认按钮重新核对本机结果并保留手工内容', async () => {
  const { api } = setup(); await generateAiSuggestion();
  fireEvent.change(screen.getByRole('textbox', { name: '摘选内容 1' }), { target: { value: '手工内容不能丢失' } });
  fireEvent.click(screen.getByRole('button', { name: '带入审核' })); await screen.findByRole('dialog', { name: '替换本段审核内容？' });
  const result = await vi.mocked(api.executeBookExtractionAi).mock.results[0].value;
  vi.mocked(api.getBookExtractionAiResult).mockResolvedValueOnce({ status: 'ready', result: { ...result, validationError: '模型配置已经变化' } });
  fireEvent.click(screen.getByRole('button', { name: '替换并重新审核' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveProperty('textContent', expect.stringContaining('模型配置已经变化')));
  expect(screen.getByRole('textbox', { name: '摘选内容 1' })).toHaveProperty('value', '手工内容不能丢失'); expect(api.confirmBookExtraction).not.toHaveBeenCalled();
});
it('失败保留审核并用原操作ID重试；取消退出需确认且不入库', async () => {
  const { api, onClose } = setup(); vi.mocked(api.confirmBookExtraction).mockRejectedValueOnce(new Error('磁盘空间不足'));
  fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  await screen.findByRole('textbox', { name: '摘选内容 1' });
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过段落 1' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '确认有权使用摘选内容' }));
  fireEvent.click(screen.getByRole('button', { name: '确认入库（1）' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '磁盘空间不足');
  expect(screen.getByRole('checkbox', { name: '审核通过段落 1' })).toHaveProperty('checked', true);
  fireEvent.click(screen.getByRole('button', { name: '返回知识库' }));
  await screen.findByRole('dialog'); expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('button', { name: '确认入库（1）' }));
  await waitFor(() => expect(api.confirmBookExtraction).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.confirmBookExtraction).mock.calls[0][0].operationId).toBe(vi.mocked(api.confirmBookExtraction).mock.calls[1][0].operationId);
});
it('取消退出令预览作废，不写库', async () => {
  const { api, onClose } = setup();
  fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  await screen.findByRole('textbox', { name: '摘选内容 1' });
  fireEvent.click(screen.getByRole('button', { name: '返回知识库' }));
  fireEvent.click(screen.getByRole('button', { name: '放弃摘选并返回' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(api.cancelBookExtraction).toHaveBeenCalledTimes(1); expect(api.confirmBookExtraction).not.toHaveBeenCalled();
});
it('取消文件选择不改状态；选择失败显示原因且可重试，未预览时可直接返回', async () => {
  const { api, onClose } = setup();
  vi.mocked(api.chooseBookExtraction).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('文件无效'));
  fireEvent.change(screen.getByRole('combobox', { name: 'TXT 编码' }), { target: { value: 'gb18030' } });
  fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '选择 TXT / DOCX' })).toHaveProperty('disabled', false));
  fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', '文件无效');
  expect(api.chooseBookExtraction).toHaveBeenLastCalledWith(expect.any(String), 'gb18030');
  fireEvent.click(screen.getByRole('button', { name: '返回知识库' }));
  await waitFor(() => expect(onClose).toHaveBeenCalled()); expect(api.cancelBookExtraction).not.toHaveBeenCalled();
});
it('分页保持审核选择；取消失败保留内容，来源更改带入确认请求', async () => {
  const { api, onClose } = setup(22);
  vi.mocked(api.cancelBookExtraction).mockRejectedValueOnce(new Error('取消失败'));
  fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  await screen.findByRole('textbox', { name: '摘选内容 1' });
  fireEvent.click(screen.getByRole('checkbox', { name: '审核通过段落 1' }));
  fireEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(screen.queryByRole('textbox', { name: '摘选内容 1' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '上一页' }));
  expect(screen.getByRole('checkbox', { name: '审核通过段落 1' })).toHaveProperty('checked', true);
  fireEvent.change(screen.getByRole('textbox', { name: '来源作品名' }), { target: { value: '准确作品名' } });
  fireEvent.change(screen.getByRole('textbox', { name: '来源作者' }), { target: { value: '准确作者' } });
  fireEvent.click(screen.getByRole('button', { name: '返回知识库' }));
  fireEvent.click(screen.getByRole('button', { name: '放弃摘选并返回' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveProperty('textContent', '取消失败'));
  expect(onClose).not.toHaveBeenCalled(); expect(screen.getByRole('textbox', { name: '摘选内容 1' })).toHaveProperty('value', '<script>优美的雨景</script>');
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '确认有权使用摘选内容' }));
  fireEvent.click(screen.getByRole('button', { name: '确认入库（1）' }));
  await waitFor(() => expect(api.confirmBookExtraction).toHaveBeenCalledWith(expect.objectContaining({ sourceTitle: '准确作品名', sourceAuthor: '准确作者' })));
});
it('文件选择解析尚未返回时同步通知脏保护，取消选择完成后解除', async () => {
  const { api, onDirtyChange } = setup();
  let resolve!: (value: null) => void;
  vi.mocked(api.chooseBookExtraction).mockReturnValueOnce(new Promise(done => { resolve = done; }));
  onDirtyChange.mockClear();
  fireEvent.click(screen.getByRole('button', { name: '选择 TXT / DOCX' }));
  expect(onDirtyChange).toHaveBeenCalledWith(true);
  expect(screen.getByRole('button', { name: '返回知识库' })).toHaveProperty('disabled', true);
  resolve(null);
  await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
});

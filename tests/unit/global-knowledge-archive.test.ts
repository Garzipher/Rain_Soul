import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { createGlobalKnowledgeArchive, parseGlobalKnowledgeArchive, GlobalKnowledgeArchiveCommands } from '../../src/main/global-knowledge-archive';

const empty = () => ({ libraryId: randomUUID(), revision: 1, entries: [], categories: [{ id: randomUUID(), name: '未分类', parentId: null, sortOrder: 0, systemKey: 'uncategorized', deletedAt: null }], tags: [], sourceAssets: { documents: [], links: [], annotations: [] }, metadata: [] });
describe('全局知识独立归档边界', () => {
  it('正式资产可以独立往返，不包含凭据或数据库路径', async () => {
    const data = empty(); expect(await parseGlobalKnowledgeArchive(await createGlobalKnowledgeArchive(data))).toEqual(data);
  });
  it('路径、数量、哈希不匹配拒绝解析', async () => {
    const zip = new JSZip(); zip.file('manifest.json', '{}'); zip.file('knowledge.json', '{}'); zip.file('secret.txt', '禁止');
    await expect(parseGlobalKnowledgeArchive(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow('条目数量');
    const valid = await JSZip.loadAsync(await createGlobalKnowledgeArchive(empty())); valid.file('knowledge.json', '{}');
    await expect(parseGlobalKnowledgeArchive(await valid.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow('SHA256');
  });
  it('取消选择不访问仓储，旧预览不能确认', async () => {
    let writes = 0;
    const commands = new GlobalKnowledgeArchiveCommands({ request: async () => { writes++; return null; } }, { choose: async () => null, save: async () => false });
    expect(await commands.execute('chooseGlobalKnowledgeArchive', {})).toBeNull();
    await expect(commands.execute('confirmGlobalKnowledgeArchive', { token: randomUUID(), operationId: randomUUID() })).rejects.toThrow('失效');
    expect(writes).toBe(0);
  });
});

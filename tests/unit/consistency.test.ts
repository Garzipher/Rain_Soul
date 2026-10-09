import { expect, it } from 'vitest';
import { analyzeConsistency } from '../../src/shared/consistency';
import type { AssetState } from '../../src/shared/assets';
import type { WorkDetail } from '../../src/shared/contracts';
import { emptyDocument } from '../../src/shared/document';
function work(): WorkDetail { const assets: AssetState = { outlines: [], foreshadows: [], evidence: [], categories: [], tags: [], knowledge: [], styleProfiles: [], chapterStyles: [], defaultStyleId: null }; return { id: 'work', title: '雨夜', revision: 9, chapters: [{ id: 'chapter', title: '第一章', document: emptyDocument(), wordCount: 0, volumeId: null }], volumes: [], deletedItems: [], assets }; }
it('空作品规则结果明确范围，不臆断角色、时间、地点和剧情矛盾', () => {
  const input = work(); const before = structuredClone(input); const report = analyzeConsistency(input);
  expect(report.workId).toBe(input.id); expect(report.baselineRevision).toBe(9); expect(report.findings).toEqual([]);
  expect(report.aiRequiredDimensions).toEqual(['角色', '时间', '地点', '剧情偏离', '写作特点漂移']); expect(input).toEqual(before);
});
it('大纲失效章节返回明确对象与来源证据，删除节点不报告', () => {
  const input = work(); input.assets!.outlines.push({ id: 'outline', type: 'chapter', title: '归来', summary: '', chapterId: 'missing', parentId: null, knowledgeIds: [], sortOrder: 0, deletedAt: null }, { id: 'deleted', type: 'chapter', title: '旧章', summary: '', chapterId: 'missing', parentId: null, knowledgeIds: [], sortOrder: 1, deletedAt: '已删' });
  const report = analyzeConsistency(input); expect(report.findings).toHaveLength(1);
  expect(report.findings[0]).toMatchObject({ code: 'outline-missing-chapter', severity: 'warning', source: { kind: 'outline', id: 'outline', chapterId: 'missing' } });
});
it('无效伏笔证据、缺少状态对应证据明确列出；历史替代和删除证据排除', () => {
  const input = work(); input.assets!.foreshadows.push({ id: 'hint', name: '旧信', status: '已回收', description: '', outlineId: null, deletedAt: null });
  const source = { chapterId: 'chapter', chapterTitle: '第一章', paragraphId: null, excerpt: '信', revision: 8 };
  const evidence = { id: 'evidence', foreshadowId: 'hint', kind: '埋设' as const, chapterId: 'chapter', paragraphId: null, excerpt: '信', sourceRevision: 8, originalSource: source, supersedesId: null, supersededBy: null, deletedAt: null, valid: false, invalidReason: '摘录已变更' };
  input.assets!.evidence.push(evidence, { ...evidence, id: 'superseded', supersededBy: 'evidence' }, { ...evidence, id: 'deleted', deletedAt: '已删' });
  const findings = analyzeConsistency(input).findings;
  expect(findings.filter(item => item.code === 'invalid-evidence')).toHaveLength(1);
  expect(findings.find(item => item.code === 'invalid-evidence')).toMatchObject({ source: { id: 'evidence', excerpt: '信', chapterId: 'chapter' } });
  expect(findings.find(item => item.code === 'foreshadow-missing-evidence')?.message).toContain('回收');
});
it('有效伏笔证据匹配状态不报错，人工固定旧写作特点仅提示，不误判漂移', () => {
  const input = work(); const doc = input.chapters[0].document; doc.content[0].content = [{ type: 'text', text: '信' }];
  input.assets!.foreshadows.push({ id: 'hint', name: '旧信', status: '已埋设', description: '', outlineId: null, deletedAt: null });
  input.assets!.evidence.push({ id: 'evidence', foreshadowId: 'hint', kind: '埋设', chapterId: 'chapter', paragraphId: doc.content[0].attrs.id, excerpt: '信', sourceRevision: 9, originalSource: { chapterId: 'chapter', chapterTitle: '第一章', paragraphId: doc.content[0].attrs.id, excerpt: '信', revision: 9 }, supersedesId: null, supersededBy: null, deletedAt: null, valid: true, invalidReason: null });
  const payload = { narrativePerson: '第三人称', pace: '慢', prohibited: [], referenceWorks: [] };
  input.assets!.styleProfiles.push({ id: 'v1', version: 1, payload, createdAt: '' }, { id: 'v2', version: 2, payload, createdAt: '' }); input.assets!.defaultStyleId = 'v2'; input.assets!.chapterStyles.push({ chapterId: 'chapter', profileId: 'v1' });
  const findings = analyzeConsistency(input).findings; expect(findings).toHaveLength(1);
  expect(findings[0]).toMatchObject({ code: 'chapter-style-older-version', severity: 'info', source: { kind: 'style', id: 'v1', chapterId: 'chapter' } });
  expect(findings[0].message).toMatch(/主动|人工|固定/);
});
it('已标有效证据如果目标段落实际不存在仍返回可追溯失效建议', () => {
  const input = work(); input.assets!.foreshadows.push({ id: 'hint', name: '旧信', status: '未埋设', description: '', outlineId: null, deletedAt: null });
  input.assets!.evidence.push({ id: 'evidence', foreshadowId: 'hint', kind: '埋设', chapterId: 'chapter', paragraphId: 'missing', excerpt: '信', sourceRevision: 9, originalSource: { chapterId: 'chapter', chapterTitle: '第一章', paragraphId: 'missing', excerpt: '信', revision: 8 }, supersedesId: null, supersededBy: null, deletedAt: null, valid: true, invalidReason: null });
  expect(analyzeConsistency(input).findings.find(item => item.code === 'invalid-evidence')?.message).toMatch(/段落/);
});
it('缺失剧情关联及写作特点版本给警告；已删伏笔和无资产作品安全跳过', () => {
  const input = work(); input.assets!.foreshadows.push({ id: 'hint', name: '旧信', status: '未埋设', description: '', outlineId: 'missing', deletedAt: null }, { id: 'deleted', name: '旧线', status: '已回收', description: '', outlineId: 'missing', deletedAt: '已删' });
  input.assets!.chapterStyles.push({ chapterId: 'chapter', profileId: 'missing' }, { chapterId: 'deleted-chapter', profileId: 'missing' });
  expect(analyzeConsistency(input).findings.map(item => item.code)).toEqual(['foreshadow-missing-outline', 'chapter-style-missing-version']);
  delete input.assets; expect(analyzeConsistency(input).findings).toEqual([]);
});

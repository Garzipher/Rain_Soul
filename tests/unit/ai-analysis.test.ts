import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AiCandidate } from '../../src/shared/ai';
import type { WorkDetail } from '../../src/shared/contracts';
import { analyzeAiCandidate } from '../../src/shared/ai-analysis';

function fixture() {
  const current: WorkDetail = { id: randomUUID(), title: '雨', revision: 4, volumes: [], deletedItems: [],
    chapters: ['前章', '当前章'].map(title => ({ id: randomUUID(), title, wordCount: 8, volumeId: null,
      document: { type: 'doc', content: [{ type: 'paragraph', attrs: { id: randomUUID() }, content: [
        { type: 'text', text: '他走向灯塔。' }, { type: 'hardBreak' }, { type: 'text', text: '雨仍未停。' },
      ] }] } })) };
  const chapter = current.chapters[1], paragraph = chapter.document.content[0];
  const evidence = { chapterId: chapter.id, paragraphId: paragraph.attrs.id, excerpt: '灯塔。\n雨仍未停' };
  const findings = [{ dimension: '地点', message: '请核对灯塔与前章地点关系。', uncertainty: '上下文有限，可能是作者有意安排。', evidence: [evidence] }];
  const candidate: AiCandidate = { id: randomUUID(), operation: 'consistency', workId: current.id, baselineRevision: 4,
    paragraphIds: [paragraph.attrs.id], text: JSON.stringify({ findings }), requestHash: 'a'.repeat(64), createdAt: new Date().toISOString() };
  return { current, chapter, evidence, findings, candidate, scope: [chapter.id] };
}

describe('AI 分析建议与正文证据核验', () => {
  it('只有真实已发送章段和精确摘录才提供定位，正文与候选均不修改', () => {
    const f = fixture(), before = structuredClone(f);
    const report = analyzeAiCandidate(f.candidate, f.current, f.scope);
    expect(report).toMatchObject({ format: 'structured', stale: false, rawText: f.candidate.text,
      findings: [{ dimension: '地点', message: f.findings[0].message, uncertainty: f.findings[0].uncertainty, evidenceVerified: true,
        evidence: [{ excerpt: f.evidence.excerpt, verified: true, invalidReason: null,
          location: { chapterId: f.chapter.id, paragraphId: f.evidence.paragraphId } }] }] });
    expect(f).toEqual(before);
  });

  it.each(['伪造章节', '伪造段落', '范围外', '错误摘录', '空摘录', '非法证据'])(
    '%s 证据保留建议但不得提供定位', variant => {
      const f = fixture();
      let evidence: unknown = { ...f.evidence };
      if (variant === '伪造章节') evidence = { ...f.evidence, chapterId: randomUUID() };
      if (variant === '伪造段落') evidence = { ...f.evidence, paragraphId: randomUUID() };
      if (variant === '范围外') evidence = { ...f.evidence, chapterId: f.current.chapters[0].id, paragraphId: f.current.chapters[0].document.content[0].attrs.id };
      if (variant === '错误摘录') evidence = { ...f.evidence, excerpt: '模型编造的正文' };
      if (variant === '空摘录') evidence = { ...f.evidence, excerpt: '   ' };
      if (variant === '非法证据') evidence = { chapterId: '../伪造路径', paragraphId: 42 };
      f.candidate.text = JSON.stringify({ findings: [{ ...f.findings[0], evidence: [evidence] }] });
      const finding = analyzeAiCandidate(f.candidate, f.current, f.scope).findings[0];
      expect(finding.message).toBe(f.findings[0].message); expect(finding.evidenceVerified).toBe(false);
      expect(finding.evidence[0]).toMatchObject({ verified: false, location: null, invalidReason: expect.any(String) });
    });

  it.each(['版本变化', '其他作品'])('%s 标记过期，真实命中也不得跳转', change => {
    const f = fixture();
    if (change === '版本变化') f.current.revision += 1; else f.current.id = randomUUID();
    const report = analyzeAiCandidate(f.candidate, f.current, f.scope);
    expect(report.stale).toBe(true); expect(report.findings[0].evidenceVerified).toBe(false);
    expect(report.findings[0].evidence[0]).toMatchObject({ verified: false, location: null, invalidReason: expect.stringContaining('过期') });
  });

  it('没有证据或部分证据非法时，不把文学建议当成已验证结论', () => {
    const f = fixture();
    f.candidate.text = JSON.stringify({ findings: [{ ...f.findings[0], evidence: [] },
      { ...f.findings[0], evidence: [f.evidence, { ...f.evidence, excerpt: '编造内容' }] }] });
    const report = analyzeAiCandidate(f.candidate, f.current, f.scope);
    expect(report.findings.map(item => item.evidenceVerified)).toEqual([false, false]);
    expect(report.findings[1].evidence.map(item => item.verified)).toEqual([true, false]);
  });

  it.each(['旧模型仅提供一段剧情建议。', '{"findings":[{"dimension":"合理性"}]}',
    '{"findings":[]}', '{"findings":[{"dimension":"未知维度","message":"建议","uncertainty":"未知","evidence":[]}]}'])(
    '纯文本或不合格结构兼容降级保留完整原文：%s', text => {
      const f = fixture(); f.candidate.operation = 'plotFeel'; f.candidate.text = text;
      const report = analyzeAiCandidate(f.candidate, f.current, f.scope);
      expect(report).toMatchObject({ format: 'text', rawText: text, findings: [{ dimension: '剧情感受', message: text,
        evidenceVerified: false, evidence: [], uncertainty: expect.stringContaining('未验证') }] });
    });

  it('接受代码围栏 JSON；空发送范围不会把当前正文当成已授权证据', () => {
    const f = fixture(); f.candidate.text = `\`\`\`json\n${f.candidate.text}\n\`\`\``;
    const report = analyzeAiCandidate(f.candidate, f.current, []);
    expect(report.format).toBe('structured'); expect(report.findings[0].evidence[0].location).toBeNull();
    expect(report.findings[0].evidence[0].invalidReason).toContain('范围');
  });

  it('摘录逐字匹配不删除边界空白，书签节点不作为正文证据', () => {
    const f = fixture();
    f.chapter.document.content[0].content!.push({ type: 'bookmark', attrs: { id: randomUUID(), kind: 'knowledge', targetId: randomUUID() } });
    for (const excerpt of [' 他走向灯塔。 ', '[知识引用]']) {
      f.candidate.text = JSON.stringify({ findings: [{ ...f.findings[0], evidence: [{ ...f.evidence, excerpt }] }] });
      expect(analyzeAiCandidate(f.candidate, f.current, f.scope).findings[0].evidence[0])
        .toMatchObject({ excerpt, verified: false, location: null });
    }
  });

  it('不处理正文修改候选，不把超限结构及错误证据伪装为可定位结果', () => {
    const f = fixture();
    expect(() => analyzeAiCandidate({ ...f.candidate, operation: 'paragraphPolish' }, f.current, f.scope)).toThrow(/仅分析/);
    f.candidate.text = JSON.stringify({ findings: Array.from({ length: 101 }, () => f.findings[0]) });
    expect(analyzeAiCandidate(f.candidate, f.current, f.scope).format).toBe('text');
    f.candidate.text = JSON.stringify({ findings: [{ ...f.findings[0], evidence: [null, '随意字符串', {}, { excerpt: '无位置摘录' }] }] });
    const finding = analyzeAiCandidate(f.candidate, f.current, f.scope).findings[0];
    expect(finding.evidence.every(item => !item.verified && item.location === null)).toBe(true);
    expect(finding.evidence[3].excerpt).toBe('无位置摘录');
  });
});

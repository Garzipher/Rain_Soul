import type { WorkDetail } from './contracts';
import type { OutlineNode } from './assets';
import { readableKnowledgeSource } from './knowledge-source';
/** 补齐选定章节的父级计划和详细场景；祖先不参与向下扩张，防止带入同卷其他章节。 */
function scopeOutlines(nodes: OutlineNode[], chapterIds: Set<string>): OutlineNode[] {
  const live = nodes.filter(node => !node.deletedAt), byId = new Map(live.map(node => [node.id, node]));
  const children = new Map<string, OutlineNode[]>();
  for (const node of live) if (node.parentId) {
    const siblings = children.get(node.parentId) ?? []; siblings.push(node); children.set(node.parentId, siblings);
  }
  const seeds = live.filter(node => node.chapterId && chapterIds.has(node.chapterId));
  const included = new Set(seeds.map(node => node.id));
  for (const seed of seeds) {
    let parentId = seed.parentId;
    const visited = new Set<string>([seed.id]);
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent || parent.chapterId && !chapterIds.has(parent.chapterId)) break;
      included.add(parent.id); parentId = parent.parentId;
    }
  }
  const expanded = new Set<string>(), queue = [...seeds];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    if (expanded.has(node.id)) continue;
    expanded.add(node.id);
    for (const child of children.get(node.id) ?? []) {
      if (child.chapterId && !chapterIds.has(child.chapterId)) continue;
      included.add(child.id); queue.push(child);
    }
  }
  return live.filter(node => included.has(node.id));
}
/** 首版按中文二字片段与英文单词匹配本作品素材，输出可预览的完整引用，不使用向量检索。 */
export function relatedAiKnowledge(work: WorkDetail, text: string) {
  const assets = work.assets; if (!assets) return [];
  const terms = new Set<string>();
  for (const match of text.toLocaleLowerCase().matchAll(/[\p{Script=Han}]{2,}|[a-z0-9]{2,}/gu)) {
    if (/\p{Script=Han}/u.test(match[0])) for (let i = 0; i < match[0].length - 1; i++) terms.add(match[0].slice(i, i + 2));
    else terms.add(match[0]);
  }
  return assets.knowledge.filter(entry => !entry.deletedAt).map(entry => ({ entry, score: [...terms].filter(term => entry.body.toLocaleLowerCase().includes(term)).length }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id)).slice(0, 5);
}
export function buildAiReferences(work: WorkDetail, chapterId: string, text: string, chapterIds: string[] = [chapterId], knowledgeIds?: string[]): string {
  const assets = work.assets; if (!assets) return '';
  const related = knowledgeIds ? assets.knowledge.filter(entry => !entry.deletedAt && knowledgeIds.includes(entry.id)).map(entry => ({ entry })) : relatedAiKnowledge(work, text);
  const chapters = new Set(chapterIds);
  const styles = chapterIds.map(id => {
    const styleId = assets.chapterStyles.find(item => item.chapterId === id)?.profileId ?? assets.defaultStyleId;
    const style = assets.styleProfiles.find(item => item.id === styleId);
    return style ? `${work.chapters.find(item => item.id === id)?.title ?? id} 写作特点 v${style.version}：${JSON.stringify(style.payload)}` : '';
  }).filter(Boolean);
  const outlines = scopeOutlines(assets.outlines, chapters);
  const outlineIds = new Set(outlines.map(item => item.id));
  const hints = assets.foreshadows.filter(item => !item.deletedAt && (item.outlineId && outlineIds.has(item.outlineId) || assets.evidence.some(evidence => evidence.foreshadowId === item.id && chapters.has(evidence.chapterId) && !evidence.deletedAt && !evidence.supersededBy)));
  return [
    styles.join('\n'),
    outlines.length ? `范围内大纲（含所属父级计划与详细场景）：\n${outlines.map(item => `${item.chapterId ? `${work.chapters.find(chapter => chapter.id === item.chapterId)?.title ?? item.chapterId} / ` : ''}${item.title}：${item.summary}`).join('\n')}` : '',
    hints.length ? `范围内伏笔：\n${hints.map(item => `${item.name} / ${item.status}：${item.description}`).join('\n')}` : '',
    related.length ? `本作品关键词知识参考（最多五条；借鉴写法，保留出处，不照搬未授权内容）：\n${related.map(({ entry }) => `[知识 ${entry.id}]\n${entry.body}\n出处：${readableKnowledgeSource(entry.source) || '未注明'}`).join('\n\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

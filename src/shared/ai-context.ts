import { z } from 'zod';
import type { WorkDetail } from './contracts';
import type { AiContext } from './ai';
export const aiContextRequestSchema = z.object({ chapterId: z.uuid(), scope: z.enum(['chapter', 'previous', 'volume', 'custom']), chapterIds: z.array(z.uuid()).min(1).optional(), targetParagraphIds: z.array(z.uuid()).min(1).optional(), sentenceText: z.string().min(1).max(20000).optional() }).strict();
export type AiContextRequest = z.infer<typeof aiContextRequestSchema>;
export function buildAiContext(work: WorkDetail, value: AiContextRequest): AiContext {
  const request = aiContextRequestSchema.parse(value), index = work.chapters.findIndex(chapter => chapter.id === request.chapterId);
  if (index < 0) throw new Error('章节不属于当前作品。');
  const current = work.chapters[index];
  if (request.scope === 'volume' && !current.volumeId) throw new Error('当前章节未归属分卷，请选择当前章节或自定义范围。');
  let selected = request.scope === 'chapter' ? [current] : request.scope === 'previous' ? work.chapters.slice(Math.max(0, index - 1), index + 1)
    : request.scope === 'volume' ? (current.volumeId ? work.chapters.filter(chapter => chapter.volumeId === current.volumeId) : [current])
      : work.chapters.filter(chapter => request.chapterIds?.includes(chapter.id));
  if (!selected.length || request.scope === 'custom' && selected.length !== new Set(request.chapterIds).size) throw new Error('自定义范围为空或含其他作品章节。');
  if (!selected.some(chapter => chapter.id === current.id)) selected = work.chapters.filter(chapter => chapter.id === current.id || selected.some(item => item.id === chapter.id));
  const paragraphIds = request.targetParagraphIds ?? current.document.content.map(paragraph => paragraph.attrs.id);
  if (new Set(paragraphIds).size !== paragraphIds.length || paragraphIds.some(id => !current.document.content.some(paragraph => paragraph.attrs.id === id))) throw new Error('目标段落不属于当前章节。');
  const plain = selected.map(chapter => `${chapter.title} [章节 ${chapter.id}]\n${chapter.document.content.map(paragraph => `[段落 ${paragraph.attrs.id}] ${(paragraph.content ?? []).map(node => node.type === 'text' ? node.text : node.type === 'hardBreak' ? '\n' : '').join('')}`).join('\n')}`).join('\n\n');
  if (!selected.some(chapter => chapter.document.content.some(paragraph => (paragraph.content ?? []).some(node => node.type === 'text' && node.text.trim())))) throw new Error('所选范围没有正文。');
  const targets = current.document.content.filter(paragraph => paragraphIds.includes(paragraph.attrs.id)).map(paragraph => (paragraph.content ?? []).filter(node => node.type === 'text').map(node => node.text).join('')).join('\n');
  let selection: AiContext['selection'];
  if (request.sentenceText !== undefined) {
    if (paragraphIds.length !== 1 || request.sentenceText.includes('\n')) throw new Error('单句润色请选择一个段落中的一句正文。');
    const paragraph = current.document.content.find(item => item.attrs.id === paragraphIds[0])!;
    const plain = (paragraph.content ?? []).map(node => node.type === 'text' ? node.text : node.type === 'hardBreak' ? '\n' : '').join('');
    const from = plain.indexOf(request.sentenceText);
    if (from < 0 || plain.indexOf(request.sentenceText, from + 1) >= 0) throw new Error('目标单句需在所选段落中唯一匹配，请重新选择。');
    selection = { paragraphId: paragraphIds[0], from, to: from + request.sentenceText.length, text: request.sentenceText };
  }
  const labels = { chapter: '当前章节', previous: '前章衔接', volume: '全卷', custom: '自定义范围' };
  return { workId: work.id, baselineRevision: work.revision, paragraphIds, referenceChapterIds: selected.map(chapter => chapter.id), scopeLabel: `${labels[request.scope]}${request.scope === 'previous' && index === 0 ? '（无前章）' : ''}：${selected.map(chapter => chapter.title).join('、')}`,
    text: `目标正文（候选只修改这部分）：\n${selection?.text ?? targets}\n\n已授权上下文：\n${plain}`, ...(selection ? { selection } : {}) };
}

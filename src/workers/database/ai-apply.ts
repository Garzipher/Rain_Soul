import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { aiOperations, type AiCandidate } from '../../shared/ai';
import { countDocumentWords, validateDocument } from '../../shared/document';
import type { WritingDocument } from '../../shared/contracts';
import { applyAsset } from './assets';
import { refreshChapterSearch } from './assets-search';
import { createSnapshot } from './snapshots';
import { RepositoryError } from './errors';
import type { AiKnowledgeApproval } from '../../shared/ai-extraction';

const candidateSchema = z.object({ id: z.uuid(), operation: z.enum(aiOperations), workId: z.uuid(), baselineRevision: z.number().int().positive(),
  paragraphIds: z.array(z.uuid()).min(1).max(50000).refine(ids => new Set(ids).size === ids.length),
  text: z.string().min(1).max(2_000_000).refine(value => !!value.trim()), requestHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.iso.datetime(),
  selection: z.object({ paragraphId: z.uuid(), from: z.number().int().nonnegative(), to: z.number().int().positive(), text: z.string().min(1).max(200000) }).strict().optional(),
  referenceChapterIds: z.array(z.uuid()).min(1).max(50000).refine(ids => new Set(ids).size === ids.length).optional(),
}).strict();
const itemsSchema = z.array(z.object({ body: z.string().min(1).max(200000).refine(value => !!value.trim()), source: z.string().max(10000), categoryId: z.uuid().optional(), tagIds: z.array(z.uuid()).max(100).refine(ids => new Set(ids).size === ids.length).optional() }).strict()).min(1).max(100);
interface ChapterRow { id: string; title: string; document_json: string }
interface Target { chapter: ChapterRow; document: WritingDocument; index: number }

function inputCandidate(value: AiCandidate): z.infer<typeof candidateSchema> {
  const parsed = candidateSchema.safeParse(value);
  if (!parsed.success) throw new RepositoryError('INVALID_INPUT', 'AI 候选内容无效，请重新生成并审核。');
  return parsed.data;
}

function replaceSentence(paragraph: WritingDocument['content'][number], candidate: z.infer<typeof candidateSchema>) {
  const selection = candidate.selection;
  if (!selection || candidate.paragraphIds.length !== 1 || selection.paragraphId !== paragraph.attrs.id) throw new RepositoryError('INVALID_INPUT', '单句润色必须提供当前单一段落的精确选区。');
  const nodes = paragraph.content ?? [], plain = nodes.map(node => node.type === 'text' ? node.text : node.type === 'hardBreak' ? '\n' : '').join('');
  const splitsSurrogate = (index: number) => index > 0 && index < plain.length && plain.charCodeAt(index - 1) >= 0xd800 && plain.charCodeAt(index - 1) <= 0xdbff && plain.charCodeAt(index) >= 0xdc00 && plain.charCodeAt(index) <= 0xdfff;
  if (selection.from >= selection.to || selection.to > plain.length || plain.slice(selection.from, selection.to) !== selection.text || splitsSurrogate(selection.from) || splitsSurrogate(selection.to)) {
    throw new RepositoryError('REVISION_CONFLICT', '单句选区内容或字符边界已失效，请重新选择并生成。');
  }
  if (/[\r\n]/.test(candidate.text) || /[\r\n]/.test(selection.text)) throw new RepositoryError('INVALID_INPUT', '单句润色不能包含或跨越换行，请改用段落润色。');
  const result: NonNullable<typeof paragraph.content> = [];
  let offset = 0, inserted = false;
  const addText = (text: string) => { if (text) result.push({ type: 'text', text }); };
  for (const node of nodes) {
    if (node.type !== 'text') { result.push(node); if (node.type === 'hardBreak') offset++; continue; }
    const end = offset + node.text.length;
    if (end < selection.from || offset >= selection.to) result.push(node);
    else {
      addText(node.text.slice(0, Math.max(0, selection.from - offset)));
      if (!inserted) { addText(candidate.text); inserted = true; }
      if (selection.to < end) addText(node.text.slice(Math.max(0, selection.to - offset)));
    }
    offset = end;
  }
  paragraph.content = result;
}
function targets(db: Database.Database, candidate: AiCandidate): Target[] {
  const found = new Map<string, Target>();
  const requested = new Set(candidate.paragraphIds);
  for (const chapter of db.prepare('SELECT id,title,document_json FROM chapter WHERE deleted_at IS NULL').all() as ChapterRow[]) {
    const document = validateDocument(JSON.parse(chapter.document_json));
    for (const [index, paragraph] of document.content.entries()) if (requested.has(paragraph.attrs.id)) {
      if (found.has(paragraph.attrs.id)) throw new RepositoryError('INVALID_INPUT', '正文目标段落身份重复，不能写入候选。');
      found.set(paragraph.attrs.id, { chapter, document, index });
    }
  }
  return candidate.paragraphIds.map(id => {
    const target = found.get(id); if (!target) throw new RepositoryError('NOT_FOUND', 'AI 候选目标段落已失效，请重新对比或生成。');
    return target;
  });
}
function knowledgeSources(db: Database.Database, candidate: AiCandidate, selected: Target[]): Target[] {
  if (!candidate.referenceChapterIds) return selected;
  const authorized = new Set(candidate.referenceChapterIds), chapters = new Map<string, Target[]>(), identities = new Map<string, number>();
  for (const chapter of db.prepare('SELECT id,title,document_json FROM chapter WHERE deleted_at IS NULL').all() as ChapterRow[]) {
    const document = validateDocument(JSON.parse(chapter.document_json));
    const paragraphs = document.content.map((paragraph, index) => {
      identities.set(paragraph.attrs.id, (identities.get(paragraph.attrs.id) ?? 0) + 1);
      return { chapter, document, index };
    });
    if (authorized.has(chapter.id)) chapters.set(chapter.id, paragraphs);
  }
  return candidate.referenceChapterIds.flatMap(id => {
    const paragraphs = chapters.get(id);
    if (!paragraphs) throw new RepositoryError('NOT_FOUND', 'AI 候选授权上下文章节已失效，请重新生成。');
    if (paragraphs.some(target => identities.get(target.document.content[target.index].attrs.id) !== 1)) throw new RepositoryError('INVALID_INPUT', '授权上下文段落身份重复，不能记录知识来源。');
    return paragraphs;
  });
}
function commit(db: Database.Database, candidate: AiCandidate, operationId: string, kind: string, detail: unknown, mutate: () => void): void {
  if (!z.uuid().safeParse(operationId).success) throw new RepositoryError('INVALID_INPUT', 'AI 写入操作标识无效。');
  const hash = createHash('sha256').update(JSON.stringify([kind, candidate, detail])).digest('hex');
  db.transaction(() => {
    const meta = db.prepare('SELECT id,revision,deleted_at FROM work_meta').get() as { id: string; revision: number; deleted_at: string | null };
    if (!meta || meta.id !== candidate.workId || meta.deleted_at) throw new RepositoryError('NOT_FOUND', 'AI 候选所属作品不存在或已删除。');
    const receipt = db.prepare('SELECT request_hash FROM operation_log WHERE operation_id=?').get(operationId) as { request_hash: string } | undefined;
    if (receipt) { if (receipt.request_hash !== hash) throw new RepositoryError('INVALID_INPUT', '操作标识已用于不同内容。'); return; }
    if (meta.revision !== candidate.baselineRevision) throw new RepositoryError('REVISION_CONFLICT', '原稿版本已变化，请重新生成或重新对比候选。');
    createSnapshot(db, kind === 'knowledge' ? 'AI 知识回写前安全快照' : 'AI 改稿前安全快照', 'safety');
    mutate();
    db.prepare('UPDATE work_meta SET revision=revision+1,updated_at=? WHERE id=?').run(new Date().toISOString(), meta.id);
    db.prepare('INSERT INTO operation_log VALUES(?,?,?)').run(operationId, hash, JSON.stringify({ revision: meta.revision + 1 }));
  }).immediate();
}

/** 作者已确认的正文候选才可进入事务；分析结果和无精准选区的单句候选不允许覆盖整段。 */
export function applyAiCandidate(db: Database.Database, value: AiCandidate, operationId: string): void {
  const candidate = inputCandidate(value);
  if (!['sentencePolish', 'paragraphPolish', 'continue', 'correct'].includes(candidate.operation) || candidate.operation !== 'sentencePolish' && candidate.selection) throw new RepositoryError('INVALID_INPUT', '此 AI 操作不能直接写入正文，请使用段落候选或人工审核。');
  commit(db, candidate, operationId, 'body', null, () => {
    const selected = targets(db, candidate), first = selected[0], last = selected.at(-1)!;
    if (selected.some(target => target.chapter.id !== first.chapter.id)) throw new RepositoryError('INVALID_INPUT', '正文替换目标必须位于同一章。');
    if (selected.some((target, index) => target.index !== first.index + index)) throw new RepositoryError('INVALID_INPUT', '正文替换目标必须按顺序连续选择。');
    const document = first.document;
    const paragraphs: WritingDocument['content'] = candidate.text.replace(/\r\n?/g, '\n').split('\n').map(text => ({
      type: 'paragraph', attrs: { id: randomUUID() }, content: text ? [{ type: 'text', text }] : [],
    }));
    if (candidate.operation === 'sentencePolish') replaceSentence(document.content[first.index], candidate);
    else if (candidate.operation === 'continue') document.content.splice(last.index + 1, 0, ...paragraphs);
    else {
      paragraphs[0].attrs.id = document.content[first.index].attrs.id;
      // 替换后全部原有书签按原顺序保留到首段；精确句内位置变化由作者复核。
      const bookmarks = selected.flatMap(target => target.document.content[target.index].content?.filter(node => node.type === 'bookmark') ?? []);
      paragraphs[0].content!.push(...bookmarks);
      document.content.splice(first.index, selected.length, ...paragraphs);
    }
    validateDocument(document);
    db.prepare('UPDATE chapter SET document_json=?,word_count=? WHERE id=?').run(JSON.stringify(document), countDocumentWords(document), first.chapter.id);
    refreshChapterSearch(db, first.chapter.id);
  });
}

/** 仅写入作者逐条审核的知识，附原候选与正文证据，不自动采信模型提取结论。 */
export function approveAiKnowledge(db: Database.Database, value: AiCandidate, input: AiKnowledgeApproval[], operationId: string): void {
  const candidate = inputCandidate(value), parsed = itemsSchema.safeParse(input);
  if (candidate.operation !== 'extractKnowledge' || candidate.selection) throw new RepositoryError('INVALID_INPUT', '只有知识提取候选可以审核入库。');
  if (!parsed.success) throw new RepositoryError('INVALID_INPUT', '请逐条审核有效知识内容，不能为空或超过限额。');
  commit(db, candidate, operationId, 'knowledge', parsed.data, () => {
    const selected = targets(db, candidate);
    const category = db.prepare("SELECT id FROM category WHERE system_key='uncategorized' AND deleted_at IS NULL").get() as { id: string } | undefined;
    if (!category) throw new RepositoryError('NOT_FOUND', '作品缺少未分类类别，无法写入知识。');
    // 来源记录表示模型获准读取的材料，不声明每条知识都被模型逐段引用。
    const evidence = knowledgeSources(db, candidate, selected).map(target => {
      const paragraph = target.document.content[target.index];
      const excerpt = paragraph.content?.map(node => node.type === 'text' ? node.text : node.type === 'hardBreak' ? '\n' : '').join('') ?? '';
      return { chapterId: target.chapter.id, chapterTitle: target.chapter.title, paragraphId: paragraph.attrs.id,
        revision: candidate.baselineRevision, excerpt, hash: createHash('sha256').update(excerpt).digest('hex'),
        role: candidate.referenceChapterIds ? 'authorized-context' : 'target',
      };
    });
    const provenance = JSON.stringify({ candidateId: candidate.id, candidateText: candidate.text, requestHash: candidate.requestHash, workId: candidate.workId, evidence });
    for (const item of parsed.data) applyAsset(db, { type: 'createKnowledge', body: item.body, source: `${item.source}${item.source ? '\n' : ''}AI 审核来源：${provenance}`, categoryId: item.categoryId ?? category.id, tagIds: item.tagIds ?? [] }, candidate.baselineRevision + 1);
  });
}

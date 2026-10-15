import { SelectField } from './select-field';
import { useEffect, useRef, useState } from 'react';
import type { AiCandidate, AiExecuteRequest, AiOperation, AiPreparedRequest } from '../../shared/ai';
import type { WorkDetail } from '../../shared/contracts';
import { StructureDialog } from './structure-dialog';
import { relatedAiKnowledge } from '../../shared/ai-reference';
import { analyzeAiCandidate } from '../../shared/ai-analysis';
import { parseAiExtraction, suggestedExtractionCategory, type AiKnowledgeApproval } from '../../shared/ai-extraction';
import { AiExtractionPanel, type ExtractionReviewItem } from './ai-extraction-panel';
import './ai-workspace.css';
import type { WritingAiRequest } from '../lib/writing-ai-selection';
import { readableKnowledgeSource } from '../../shared/knowledge-source';
import { LocalReferencePanel } from './local-reference-panel';
import type { RetrievalQuery, RetrievalReply } from '../../shared/retrieval';
import { diffText } from '../../shared/text-diff';
import type { GlobalEntryRef } from '../../shared/global-knowledge';
export interface AiReviewState { candidate: AiCandidate | null; original: string; items: ExtractionReviewItem[] }
export interface AiWorkspaceProps {
  onActivityChange?: (active: boolean) => void;
  initialReview?: AiReviewState;
  onReviewChange?: (review: AiReviewState) => void;
  selectedReferenceIds?: string[];
  onRetrieve?: (request: RetrievalQuery) => Promise<RetrievalReply>;
  entryToken?: number;
  selectionRequest?: WritingAiRequest;
  onLocate?: (chapterId: string, paragraphId: string) => void;
  work: WorkDetail; chapterId: string | null; busy: boolean;
  onPrepare: (request: { operation: AiOperation; scope: 'chapter' | 'previous' | 'volume' | 'custom'; chapterIds?: string[]; instruction?: string; targetParagraphIds?: string[]; sentenceText?: string; sentenceFrom?: number; referenceKnowledgeIds?: string[]; referenceGlobalKnowledge?: GlobalEntryRef[] }) => Promise<AiPreparedRequest>;
  onExecute: (request: AiExecuteRequest) => Promise<AiCandidate>; onCancel: (token: string) => void | Promise<void>;
  onApply: (candidateId: string) => Promise<boolean>; onExtract: (candidateId: string, items: AiKnowledgeApproval[]) => Promise<boolean>;
}
const operations: [AiOperation, string][] = [['sentencePolish', '单句润色'], ['paragraphPolish', '段落润色'], ['continue', '续写'], ['correct', '纠错'], ['consistency', '一致性检查'], ['plotFeel', '剧情感受'], ['extractKnowledge', '正文回写知识']];
const paragraphText = (paragraph: WorkDetail['chapters'][number]['document']['content'][number]) => (paragraph.content ?? []).map(node => node.type === 'text' ? node.text : node.type === 'hardBreak' ? '\n' : '').join('');
export function AiWorkspace(props: AiWorkspaceProps) {
  const [operation, setOperation] = useState<AiOperation>('paragraphPolish');
  const [scope, setScope] = useState<'chapter' | 'previous' | 'volume' | 'custom'>('chapter');
  const [chapterIds, setChapterIds] = useState<string[]>([]), [targetIds, setTargetIds] = useState<string[]>([]);
  const [instruction, setInstruction] = useState(''), [prepared, setPrepared] = useState<AiPreparedRequest | null>(null);
  const [sentenceText, setSentenceText] = useState('');
  const [sentenceFrom, setSentenceFrom] = useState<number>();
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [globalReferences, setGlobalReferences] = useState<GlobalEntryRef[]>([]);
  const [candidate, setCandidate] = useState<AiCandidate | null>(props.initialReview?.candidate?.workId === props.work.id ? props.initialReview.candidate : null), [original, setOriginal] = useState(props.initialReview?.original ?? '');
  const pendingOriginal = useRef('');
  const [items, setItems] = useState<ExtractionReviewItem[]>(props.initialReview?.items ?? []);
  const reviewChange = useRef(props.onReviewChange); reviewChange.current = props.onReviewChange;
  useEffect(() => { reviewChange.current?.({ candidate, original, items }); }, [candidate, original, items]);
  const [pending, setPending] = useState(false), [sending, setSending] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { props.onActivityChange?.(pending || sending || !!prepared); }, [pending, sending, prepared, props.onActivityChange]);
  const lock = useRef(false), token = useRef<string | null>(null), alive = useRef(true);
  const generation = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!sending) return;
    setElapsed(0);
    const started = Date.now(), timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [sending]);
  const chapter = props.work.chapters.find(item => item.id === props.chapterId), disabled = props.busy || pending;
  const chapterIndex = props.work.chapters.findIndex(item => item.id === props.chapterId);
  const referenceChapters = scope === 'previous' ? props.work.chapters.slice(Math.max(0, chapterIndex - 1), chapterIndex + 1)
    : scope === 'volume' && chapter?.volumeId ? props.work.chapters.filter(item => item.volumeId === chapter.volumeId)
    : scope === 'custom' ? props.work.chapters.filter(item => chapterIds.includes(item.id) || item.id === props.chapterId) : chapter ? [chapter] : [];
  const related = relatedAiKnowledge(props.work, referenceChapters.map(item => item.document.content.map(paragraphText).join('\n')).join('\n'));
  useEffect(() => {
    setTargetIds([]); setSentenceText(''); setSentenceFrom(undefined); setOperation('paragraphPolish');
  }, [props.chapterId, props.entryToken]);
  useEffect(() => {
    const selection = props.selectionRequest;
    if (!selection) return;
    setOperation(selection.operation); setTargetIds(selection.paragraphIds); setSentenceText(selection.text); setSentenceFrom(selection.sentenceFrom); setScope('chapter'); setError('');
  }, [props.selectionRequest]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (token.current) void Promise.resolve(props.onCancel(token.current)).catch(() => undefined); }; }, [props.work.id]);
  async function run(task: (operationId: number) => Promise<void>) {
    if (lock.current || props.busy) return;
    const operationId = ++generation.current;
    lock.current = true; setPending(true); setError(''); setNotice('');
    try { await task(operationId); } catch (reason) { if (alive.current && generation.current === operationId) setError(reason instanceof Error ? reason.message : 'AI 操作失败，请手动重试。'); }
    finally { if (generation.current === operationId) { lock.current = false; if (alive.current) setPending(false); } }
  }
  function preview() {
    void run(async operationId => {
      if (!chapter) throw new Error('请先选择正文章节。');
      if (scope === 'custom' && !chapterIds.length) throw new Error('请至少选择一个自定义章节。');
      if (operation === 'sentencePolish') {
        if (targetIds.length !== 1) throw new Error('单句润色需要明确选择单个段落。');
        const paragraph = chapter.document.content.find(item => item.attrs.id === targetIds[0]);
        if (!paragraph) throw new Error('选中的段落已变化，请返回正文重新选择。');
        const text = paragraphText(paragraph);
        if (!sentenceText.trim() || (sentenceFrom === undefined ? text.indexOf(sentenceText) < 0 || text.indexOf(sentenceText) !== text.lastIndexOf(sentenceText) : text.slice(sentenceFrom, sentenceFrom + sentenceText.length) !== sentenceText)) throw new Error('目标单句已变化或无法唯一匹配，请重新选择。');
      }
      const selected = targetIds.length ? chapter.document.content.filter(item => targetIds.includes(item.attrs.id)) : chapter.document.content;
      if (['paragraphPolish', 'continue', 'correct'].includes(operation)) {
        const positions = selected.map(item => chapter.document.content.indexOf(item));
        if (positions.some((position, index) => position !== positions[0] + index)) throw new Error('正文候选请选择连续的目标段落，未发送请求。');
      }
      const baseline = operation === 'sentencePolish' ? sentenceText : selected.map(paragraphText).join('\n');
      const validReferenceIds = [...new Set([...(props.selectedReferenceIds ?? []), ...referenceIds])].filter(id => props.onRetrieve ? props.work.assets?.knowledge.some(entry => entry.id === id && !entry.deletedAt) : related.some(item => item.entry.id === id));
      if (validReferenceIds.length + globalReferences.length > 5) throw new Error('作品与全局合计最多选用五条参考，请先移除多余条目。');
      const value = await props.onPrepare({ operation, scope, chapterIds: scope === 'custom' ? chapterIds : undefined, instruction: instruction || undefined, targetParagraphIds: selected.map(item => item.attrs.id), referenceKnowledgeIds: validReferenceIds, referenceGlobalKnowledge: globalReferences, ...(operation === 'sentencePolish' ? { sentenceText, ...(sentenceFrom !== undefined ? { sentenceFrom } : {}) } : {}) });
      if (!alive.current || generation.current !== operationId) { await props.onCancel(value.confirmationToken); return; }
      token.current = value.confirmationToken; pendingOriginal.current = baseline; setPrepared(value);
    });
  }
  async function execute(): Promise<boolean> {
    const value = prepared; if (!value || lock.current || props.busy) return false;
    const candidateOriginal = pendingOriginal.current;
    await run(async operationId => {
      setPrepared(null); setSending(true);
      try {
        const result = await props.onExecute({ confirmationToken: value.confirmationToken, requestHash: value.requestHash, confirmed: true });
        if (!alive.current || generation.current !== operationId) return;
        setCandidate(result); setOriginal(candidateOriginal); setItems([]);
        if (result.operation === 'extractKnowledge') setItems(parseAiExtraction(result.text).map(item => ({ ...item, source: item.source || `${props.work.title} / ${chapter?.title ?? '正文'}`, checked: false,
          categoryId: suggestedExtractionCategory(props.work.assets?.categories ?? [], item.suggestedCategory),
          tagIds: props.work.assets?.tags.filter(tag => !tag.deletedAt && item.suggestedTags.includes(tag.name)).map(tag => tag.id) ?? [],
        })));
      } finally { if (generation.current === operationId) { token.current = null; if (alive.current) setSending(false); } }
    });
    return false;
  }
  function cancel() {
    const current = token.current; token.current = null; setPrepared(null);
    generation.current++; lock.current = false; setPending(false); setSending(false);
    setNotice('已停止本次操作，原文未修改。已发送的请求可能仍由服务方计费。');
    if (current) void Promise.resolve(props.onCancel(current)).catch(() => { if (alive.current) setError('停止指令未完成；本地已忽略此次结果，可继续编辑。'); });
  }
  const isAnalysis = candidate?.operation === 'consistency' || candidate?.operation === 'plotFeel';
  const analysis = candidate && isAnalysis ? analyzeAiCandidate(candidate, props.work, candidate.referenceChapterIds ?? []) : null;
  const stale = candidate && candidate.baselineRevision !== props.work.revision;
  const movedBookmarks = candidate && ['paragraphPolish', 'correct'].includes(candidate.operation)
    ? props.work.chapters.flatMap(item => item.document.content).filter(item => candidate.paragraphIds.includes(item.attrs.id)).flatMap(item => item.content ?? []).filter(item => item.type === 'bookmark').length : 0;
  return <section className="ai-workspace" aria-label="AI 写作助手"><div className="ai-request-form">
    <h2>AI 写作助手</h2><p className="ai-muted">云端生成新的写作候选，采用前由你审核。正文中的灰字来自本机知识原句，二者独立。</p>
    <label>AI 操作<SelectField aria-label="AI 操作" value={operation} disabled={disabled} onChange={event => setOperation(event.target.value as AiOperation)}>{operations.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</SelectField></label>
    {props.selectionRequest && <p className="ai-muted">已选定 {props.selectionRequest.paragraphIds.length} 个段落。单句润色只替换选中原文；段落润色和纠错处理选区涉及的完整段落，续写追加在目标段落之后。</p>}
    {operation === 'sentencePolish' && <label>目标单句<input aria-label="目标单句" value={sentenceText} disabled={disabled} onChange={event => { setSentenceText(event.target.value); setSentenceFrom(undefined); }} placeholder="从一个已选段落中复制需要润色的单句" /></label>}
    <label>上下文范围<SelectField aria-label="上下文范围" value={scope} disabled={disabled} onChange={event => setScope(event.target.value as typeof scope)}><option value="chapter">当前章节</option><option value="previous">前章衔接</option><option value="volume" disabled={!chapter?.volumeId}>全卷</option><option value="custom">自定义范围</option></SelectField></label>
    {scope === 'previous' && chapterIndex === 0 && <p className="ai-muted">当前是首章，没有前章，仅发送当前章节。</p>}
    {scope === 'custom' && <fieldset disabled={disabled}><legend>自定义章节</legend>{props.work.chapters.map(item => <label key={item.id}><input type="checkbox" checked={chapterIds.includes(item.id)} onChange={event => setChapterIds(previous => event.target.checked ? [...previous, item.id] : previous.filter(id => id !== item.id))} />{item.title}</label>)}</fieldset>}
    <details><summary>指定目标段落（默认当前章全部段落）</summary><fieldset disabled={disabled}>{chapter?.document.content.map((paragraph, index) => <label key={paragraph.attrs.id}><input type="checkbox" checked={targetIds.includes(paragraph.attrs.id)} onChange={event => setTargetIds(previous => event.target.checked ? [...previous, paragraph.attrs.id] : previous.filter(id => id !== paragraph.attrs.id))} />第 {index + 1} 段 · {paragraphText(paragraph).slice(0, 50) || '空段落'}</label>)}</fieldset></details>
    <details><summary>知识参考 · 作者选用</summary>{props.onRetrieve ? <LocalReferencePanel workId={props.work.id} revision={props.work.revision} entries={props.work.assets?.knowledge ?? []} busy={disabled} onRetrieve={props.onRetrieve} onSelect={setReferenceIds} onGlobalSelect={setGlobalReferences} maxSelections={Math.max(0, 5 - (props.selectedReferenceIds?.length ?? 0))} /> : <><p className="ai-muted">按本作品关键词推荐最多五条，勾选后加入发送预览，借鉴写法与表达。</p><fieldset disabled={disabled}><legend>可选知识参考</legend>{related.length ? related.map(({ entry }) => <div key={entry.id}><label><input type="checkbox" checked={referenceIds.includes(entry.id)} onChange={event => setReferenceIds(previous => event.target.checked ? [...previous, entry.id] : previous.filter(id => id !== entry.id))} /><span>{entry.body}</span></label><small>{readableKnowledgeSource(entry.source) || '未注明出处'}</small></div>) : <p>当前范围没有匹配的知识参考。</p>}</fieldset></>}</details>
    {!!props.selectedReferenceIds?.length && <p role="status">知识库已选用 {props.selectedReferenceIds.length} 条参考；完整内容将在发送前预览。</p>}
    <label>作者补充要求<textarea aria-label="作者补充要求" value={instruction} disabled={disabled} onChange={event => setInstruction(event.target.value)} placeholder="可填写希望保留的语气与表达" /></label>
    <button className="primary" disabled={disabled || !chapter} onClick={preview}>预览 AI 请求</button>{sending && <button className="secondary" onClick={cancel}>取消 AI 请求</button>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}{pending && <p role="status">{sending ? `正在生成候选 · ${elapsed} 秒${elapsed >= 15 ? '，服务响应较慢，可随时停止' : ''}` : '正在整理发送范围…'}</p>}
  </div>
  {candidate && <div className="ai-candidate"><h2>{isAnalysis ? 'AI 建议' : '待审核候选'}</h2>{candidate.referenceNotice && <p role="status">{candidate.referenceNotice}</p>}<p className="ai-muted">基线版本 {candidate.baselineRevision} · 结果可能有误，请结合原文证据判断。</p>
    <p className="ai-muted">{candidate.operation === 'extractKnowledge' ? '授权上下文章节' : '目标章节'}：{props.work.chapters.filter(item => candidate.operation === 'extractKnowledge' && candidate.referenceChapterIds ? candidate.referenceChapterIds.includes(item.id) : item.document.content.some(paragraph => candidate.paragraphIds.includes(paragraph.attrs.id))).map(item => item.title).join('、') || '原来源章节已删除'}。关闭工具后候选仍保留，切换章节不会把候选改为新章正文。</p>
    {stale && <p role="status">结果已过期：原文或作品资料已经变化，请重新生成后再使用。</p>}
    {movedBookmarks > 0 && <p role="status">应用后 {movedBookmarks} 个书签会完整保留到替换首段末尾，原来的句内位置将变化，请确认后重新核对位置。</p>}
    {isAnalysis ? <p>这是 AI 建议，证据与不确定性请逐项核对。</p> : <div aria-label="原文对比" className="ai-original"><h3>原文</h3><pre>{original}</pre></div>}
    {analysis ? <div className="ai-proposal"><h3>分析建议</h3>{analysis.findings.map((finding, index) => <article key={index} className="ai-analysis-finding"><strong>{finding.dimension} · AI 建议</strong><p>{finding.message}</p><p className="ai-muted">不确定性：{finding.uncertainty}</p>{!finding.evidence.length && <p className="ai-muted">未验证：没有可核对的正文证据。</p>}{finding.evidence.map((evidence, number) => <div key={number}><blockquote>{evidence.excerpt}</blockquote><p className="ai-muted">{evidence.verified ? '摘录与正文位置已核对；文学判断仍须作者评估。' : evidence.invalidReason}</p>{evidence.location && props.onLocate && <button className="secondary" disabled={disabled} onClick={() => props.onLocate!(evidence.location!.chapterId, evidence.location!.paragraphId)}>定位正文证据</button>}</div>)}</article>)}{analysis.format === 'structured' && <details><summary>模型原始结果</summary><pre>{candidate.text}</pre></details>}</div> : <div className="ai-proposal"><h3>候选内容</h3><pre aria-label="候选全文">{candidate.text}</pre>{candidate.operation !== 'extractKnowledge' && <div aria-label="增删差异"><h3>增删差异</h3><p className="ai-muted">删除内容带删除线，新增内容带下划线。</p><pre>{diffText(original, candidate.operation === 'continue' ? `${original}\n${candidate.text}` : candidate.text).map((piece, index) => piece.kind === 'delete' ? <del key={index} aria-label="删除">{piece.text}</del> : piece.kind === 'insert' ? <ins key={index} aria-label="新增">{piece.text}</ins> : <span key={index}>{piece.text}</span>)}</pre></div>}</div>}
    <button className="secondary" disabled={disabled} onClick={() => { setCandidate(null); setItems([]); setNotice('已放弃候选，正文未修改。'); }}>放弃此候选</button>
    {candidate.operation === 'extractKnowledge' ? <><AiExtractionPanel items={items} assets={props.work.assets} disabled={disabled} onChange={(index, patch) => setItems(previous => previous.map((item, position) => position === index ? { ...item, ...patch } : item))} />
      <button className="primary" disabled={disabled || !!stale || !items.some(item => item.checked && item.body.trim())} onClick={() => void run(async () => {
        const approvals: AiKnowledgeApproval[] = items.filter(item => item.checked && item.body.trim()).map(({ body, source, categoryId, tagIds, mode, targetId }) => {
          const content = { body, source, ...(categoryId ? { categoryId } : {}), ...(tagIds.length ? { tagIds } : {}) };
          if (mode !== 'update') return content;
          if (!targetId || !props.work.assets?.knowledge.some(entry => entry.id === targetId && !entry.deletedAt)) throw new Error('更新目标已失效，请重新选择并审核。');
          const destination = categoryId || props.work.assets.categories.find(category => category.systemKey === 'uncategorized' && !category.deletedAt)?.id;
          if (!destination) throw new Error('更新分类已失效，请重新选择并审核。');
          return { ...content, categoryId: destination, tagIds, mode: 'update', targetId };
        });
        if (!await props.onExtract(candidate.id, approvals)) throw new Error('知识候选未入库，请检查正文来源并重新审核。');
        setNotice('已将审核通过条目写入当前作品知识库。'); setCandidate(null);
      })}>确认入库已审核条目</button></>
      : !isAnalysis && <button className="primary" disabled={disabled || !!stale} onClick={() => void run(async () => { if (!await props.onApply(candidate.id)) throw new Error('原文可能已变化，候选未写入。请重新生成或重新对比。'); setNotice('候选已确认写入，原文版本由快照保留。'); setCandidate(null); })}>确认写入正文</button>}
  </div>}
  {prepared && <StructureDialog busy={disabled} onClose={cancel} state={{ heading: '确认云端 AI 操作', description: `${prepared.service} · ${prepared.model} · ${prepared.scopeLabel}`, submitLabel: '确认发送', submitTone: 'primary', onSubmit: execute }}><p>{prepared.billingHint}</p><p>预计输入 {prepared.estimatedInputTokens} token；输出上限 {prepared.maxOutputTokens} token。</p><details open><summary>完整发送内容</summary><pre className="ai-send-preview">{prepared.previewText}</pre></details></StructureDialog>}
  </section>;
}

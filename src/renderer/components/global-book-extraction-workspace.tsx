import { AnimatePresence } from 'motion/react';
import { GlobalBookExtractionAiPanel } from './global-book-extraction-ai-panel';
import type { GlobalBookExtractionAiApi } from '../../shared/global-book-extraction-ai';
import { useEffect, useRef, useState } from 'react';
import type { BookExtractionApi } from '../../shared/book-extraction';
import type { GlobalBookExtractionConfirmation, GlobalExtractionApi, GlobalExtractionDraft, GlobalExtractionPreview } from '../../shared/global-book-extraction';
import type { GlobalKnowledgePage, GlobalSourceMetadata } from '../../shared/global-knowledge';
import { SelectField } from './select-field';
import { StructureDialog } from './structure-dialog';
import { extractionCategoryPath } from '../../shared/ai-extraction';
import { globalSourceStarterText, globalSourceStarters, type GlobalSourceStarter } from '../../shared/global-source-starter';
import { GlobalSourceStarterPanel } from './global-source-starter-panel';

type Api = GlobalExtractionApi & Partial<GlobalBookExtractionAiApi> & Pick<BookExtractionApi, 'getWebRenderCapability'>;
type Review = GlobalExtractionDraft['reviews'][number];
interface Props { page: GlobalKnowledgePage; api: Api; onCommitted(page: GlobalKnowledgePage): void; onClose(): void; onDirtyChange?(dirty: boolean): void }
const blankAnnotation = { technique: '', usage: '', exercise: '' };
/** 全局目标不依赖活动作品；未审核来源留在本机草稿，正式库仅接收已确认短摘录。 */
export function GlobalBookExtractionWorkspace({ page: library, api, onCommitted, onClose, onDirtyChange }: Props) {
  const [aiBusy, setAiBusy] = useState(false), [batches, setBatches] = useState<GlobalExtractionDraft['batches']>([]);
  const [preview, setPreview] = useState<GlobalExtractionPreview | null>(null);
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const [kind, setKind] = useState<'file' | 'web' | 'paste'>('file');
  const [encoding, setEncoding] = useState<'utf-8' | 'gb18030'>('utf-8');
  const [url, setUrl] = useState(''), [paste, setPaste] = useState(''), [pasteTitle, setPasteTitle] = useState('');
  const [sourceTitle, setSourceTitle] = useState(''), [author, setAuthor] = useState(''), [chapter, setChapter] = useState('');
  const [sourceMetrics, setSourceMetrics] = useState<GlobalSourceStarter['metrics']>([]);
  const [rights, setRights] = useState<GlobalSourceMetadata['rightsBasis']>('public-excerpt');
  const [permission, setPermission] = useState(false), [busy, setBusy] = useState(true), [blocked, setBlocked] = useState(false);
  const [error, setError] = useState(''), [message, setMessage] = useState(''), [page, setPage] = useState(0);
  const [renderReady, setRenderReady] = useState(false), [confirmRender, setConfirmRender] = useState(false);
  const [discard, setDiscard] = useState(false), [pendingReceipt, setPendingReceipt] = useState(false);
  const operation = useRef<string | null>(null), attempt = useRef<{ fingerprint: string; id: string } | null>(null), locked = useRef(false);
  const latest = useRef({ preview, reviews, sourceTitle, sourceAuthor: author, chapter, rightsBasis: rights, metrics: sourceMetrics });
  latest.current = { preview, reviews, sourceTitle, sourceAuthor: author, chapter, rightsBasis: rights, metrics: sourceMetrics };
  const categories = library.categories.filter(item => !item.deletedAt), tags = library.tags.filter(item => !item.deletedAt);
  const accept = (value: GlobalExtractionPreview, saved: Review[] = [], savedBatches: GlobalExtractionDraft['batches'] = []) => {
    if (value.target.kind !== 'global') throw new Error('素材目标不属于全局知识库。');
    const categoryId = categories.find(item => item.systemKey === 'uncategorized')?.id ?? categories[0]?.id ?? '';
    const map = new Map(saved.map(item => [item.segmentId, item]));
    setBatches(savedBatches); setPreview(value); setReviews(Object.fromEntries(value.segments.map(segment => [segment.id, map.get(segment.id) ?? {
      segmentId: segment.id, body: segment.text, categoryId, tagIds: [], status: 'pending', annotation: { ...blankAnnotation },
    }])));
    setSourceTitle(value.source?.title ?? value.filename); setAuthor(''); setChapter(''); setRights('public-excerpt'); setSourceMetrics([]);
    setPermission(false); setPage(0);
  };
  function restoreMetadata(metadata: GlobalExtractionDraft['metadata']) {
    if (!metadata) return;
    setSourceTitle(metadata.sourceTitle); setAuthor(metadata.sourceAuthor); setChapter(metadata.chapter); setRights(metadata.rightsBasis); setSourceMetrics(metadata.metrics);
  }
  useEffect(() => {
    let alive = true;
    void api.readGlobalExtractionDraft().then(recovered => {
      if (!alive || !recovered) return;
      accept(recovered.preview, recovered.draft.reviews, recovered.draft.batches); restoreMetadata(recovered.draft.metadata); if (recovered.page) onCommitted(recovered.page);
    }).catch(failure => { if (alive) { setBlocked(true); setError(failure instanceof Error ? failure.message : '全局草稿恢复失败。'); } })
      .finally(() => { if (alive) setBusy(false); });
    void api.getWebRenderCapability?.().then(value => { if (alive) setRenderReady(value.enabled); }).catch(() => {});
    return () => { alive = false; };
    // 工作区按挂载恢复一次；字典变化不覆盖作者正在审核的草稿。
  }, [api]);
  useEffect(() => { onDirtyChange?.(busy || aiBusy || !!preview); }, [busy, aiBusy, preview, onDirtyChange]);
  async function persist() {
    const current = latest.current;
    if (current.preview) await api.saveGlobalExtractionReview({ token: current.preview.token, reviews: Object.values(current.reviews), metadata: {
      sourceTitle: current.sourceTitle, sourceAuthor: current.sourceAuthor, chapter: current.chapter, rightsBasis: current.rightsBasis, metrics: current.metrics,
    } });
  }
  async function loadStarter(starter: GlobalSourceStarter) {
    if (locked.current || blocked || preview) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const value = await api.previewGlobalPastedExtraction({ starterId: starter.id, title: `${starter.workTitle} · ${starter.chapter}`, text: globalSourceStarterText(starter), source: {
        workUrl: starter.workUrl, chapterUrl: starter.chapterUrl, author: starter.author, chapter: starter.chapter, fetchedAt: starter.fetchedAt, metrics: starter.metrics,
      } });
      const starterReviews = value.segments.flatMap(segment => {
        const excerpt = starter.excerpts.find(item => item.text === segment.text && item.paragraphIndex === segment.paragraphIndex);
        if (!excerpt) return [];
        const categoryId = categories.find(item => item.systemKey === excerpt.categoryKey)?.id
          ?? categories.find(item => item.systemKey === 'uncategorized')?.id ?? categories[0]?.id ?? '';
        return [{ segmentId: segment.id, body: segment.text, categoryId, tagIds: [], status: 'pending' as const,
          annotation: { ...excerpt.annotation } }];
      });
      accept(value, starterReviews); setSourceTitle(starter.workTitle); setAuthor(starter.author); setChapter(starter.chapter); setRights('public-excerpt'); setSourceMetrics(starter.metrics);
      setMessage('已载入首批核实素材。原句仍需逐条核对，确认后才会进入全局库。');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '首批素材载入失败。'); }
    finally { locked.current = false; setBusy(false); }
  }
  function update(id: string, patch: Partial<Review>) { setReviews(current => ({ ...current, [id]: { ...current[id], ...patch } })); }
  async function source(mode: 'static' | 'restricted-browser' = 'static') {
    if (locked.current || blocked || preview) return;
    locked.current = true; setBusy(true); setError('');
    try {
      let value: GlobalExtractionPreview | null;
      if (kind === 'file') value = await api.chooseGlobalBookExtraction(encoding);
      else if (kind === 'paste') value = await api.previewGlobalPastedExtraction({ title: pasteTitle, text: paste });
      else { operation.current = crypto.randomUUID(); value = await api.fetchGlobalWebExtraction({ operationId: operation.current, url, mode }); }
      if (value) { accept(value); setMessage('原文已冻结在本机草稿。请摘选短句并核对出处后入库。'); }
    } catch (failure) { setError(failure instanceof Error ? failure.message : '素材读取失败。'); }
    finally { operation.current = null; locked.current = false; setBusy(false); }
  }
  async function recover() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      const value = await api.readGlobalExtractionDraft();
      if (value) { accept(value.preview, value.draft.reviews, value.draft.batches); restoreMetadata(value.draft.metadata); if (value.page) onCommitted(value.page); }
      setBlocked(false); setPendingReceipt(false); setMessage('本机入库状态已核对，未发送云端请求。');
    } catch (failure) { setError(failure instanceof Error ? failure.message : '回执核对失败。'); }
    finally { locked.current = false; setBusy(false); }
  }
  const selected = Object.values(reviews).filter(item => item.status === 'approved');
  async function commit() {
    if (!preview || locked.current || aiBusy || !permission || !selected.length || pendingReceipt) return;
    const content = { token: preview.token, expectedRevision: library.revision, sourceTitle, sourceAuthor: author, chapter,
      rightsBasis: rights, metrics: sourceMetrics, permissionConfirmed: true as const, items: selected.map(({ segmentId, body, categoryId, tagIds, annotation }) => ({ segmentId, body, categoryId, tagIds, annotation })) };
    const fingerprint = JSON.stringify(content);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, id: crypto.randomUUID() };
    const request: GlobalBookExtractionConfirmation = { ...content, operationId: attempt.current.id };
    locked.current = true; setBusy(true); setError('');
    try {
      await persist(); setPendingReceipt(true);
      const value = await api.confirmGlobalBookExtraction(request); onCommitted(value);
      setReviews(current => Object.fromEntries(Object.entries(current).map(([id, item]) => [id, item.status === 'approved' ? { ...item, status: 'committed' } : item])));
      setPendingReceipt(false); attempt.current = null; setMessage(`已将 ${selected.length} 条审核短摘录加入全局库，所有作品可参考。`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : '入库失败，请先核对本机回执。'); }
    finally { locked.current = false; setBusy(false); }
  }
  async function close() {
    if (locked.current || aiBusy || pendingReceipt) return;
    locked.current = true; setBusy(true); setError('');
    try { await persist(); if (preview) await api.cancelGlobalBookExtraction(preview.token); onDirtyChange?.(false); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '草稿保存失败，内容已保留。'); }
    finally { locked.current = false; setBusy(false); }
  }
  return <section className="book-extraction" aria-label="全局拆书工作区" aria-busy={busy}>
    <header className="book-extraction-header"><div><h1>拆书工具</h1><p>全局写作储备 · 所有作品均可检索参考</p></div><div>
      <button disabled={busy || aiBusy} onClick={() => void recover()}>核对入库回执</button>
      {preview && <button disabled={busy || aiBusy || pendingReceipt} onClick={() => setDiscard(true)}>更换素材</button>}
      <button disabled={busy || aiBusy || pendingReceipt} onClick={() => void close()}>保存草稿并返回</button></div></header>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {pendingReceipt && <p role="status">本批结果待核对。请先点击“核对入库回执”，避免重复入库。</p>}
    <fieldset className="book-extraction-import" disabled={busy || blocked || !!preview}>
      <div className="book-extraction-source-tabs" role="group" aria-label="素材来源">{([['file', '本地文件'], ['web', '网页文章'], ['paste', '粘贴正文']] as const).map(([id, label]) => <button key={id} aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>)}</div>
      <div className="book-extraction-toolbar">{kind === 'file' ? <><label>TXT 编码<SelectField value={encoding} onChange={event => setEncoding(event.target.value as typeof encoding)}><option value="utf-8">UTF-8</option><option value="gb18030">GB18030</option></SelectField></label><button className="primary" onClick={() => void source()}>选择 TXT / DOCX</button></> : kind === 'web' ? <><label className="book-extraction-address">公开网页地址<input type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://" /></label><button disabled={!url.trim()} className="primary" onClick={() => void source()}>获取并预览</button><button disabled={!renderReady || !url.trim()} onClick={() => setConfirmRender(true)}>受限渲染</button></> : <div className="book-extraction-paste"><label>素材标题<input value={pasteTitle} maxLength={200} onChange={event => setPasteTitle(event.target.value)} /></label><label>粘贴原文<textarea value={paste} onChange={event => setPaste(event.target.value)} /></label><button disabled={!pasteTitle.trim() || !paste.trim()} className="primary" onClick={() => void source()}>预览粘贴内容</button></div>}</div>
    </fieldset>
    {!preview && <GlobalSourceStarterPanel sources={globalSourceStarters} disabled={busy || blocked} onSelect={starter => void loadStarter(starter)} />}
    {busy && operation.current && <button onClick={() => void api.cancelGlobalWebExtraction(operation.current!)}>取消获取</button>}
    {!preview && <p className="book-extraction-empty">来源 → 选段 → 学习卡 → 审核入库。支持手工摘选与 AI 学习建议，所有候选逐条审核后才入库。</p>}
    {preview && <><div className="book-extraction-source"><p>{preview.filename} · {preview.segments.length} 段 · 来源全文仅存本机待审草稿</p>
      {preview.source?.originalUrl && <p>原始网址：{preview.source.originalUrl}<br />最终网址：{preview.source.finalUrl}<br />获取时间：{preview.source.fetchedAt}</p>}
      <label>来源作品名<input value={sourceTitle} maxLength={200} disabled={busy || aiBusy} onChange={event => setSourceTitle(event.target.value)} /></label>
      <label>作者<input value={author} maxLength={200} disabled={busy || aiBusy} onChange={event => setAuthor(event.target.value)} /></label>
      <label>章节<input value={chapter} maxLength={200} disabled={busy || aiBusy} onChange={event => setChapter(event.target.value)} /></label>
      <label>使用依据<SelectField value={rights} disabled={busy || aiBusy} onChange={event => setRights(event.target.value as typeof rights)}><option value="public-excerpt">官方公开阅读 · 短摘录学习</option><option value="owned">作者自有文本</option><option value="authorized">已获授权</option><option value="public-domain">公有领域</option><option value="open-license">开放许可</option></SelectField></label>
      <label><input type="checkbox" checked={permission} disabled={busy || aiBusy} onChange={event => setPermission(event.target.checked)} />我已核对作者、作品、章节及原文，确认有权使用所选短摘录。</label>
      <p>同次公开阅读来源最多 3 条、累计 300 字。原文与学习讲解分开保存；不将页面互动量解释为评分。</p></div>
      {api.prepareGlobalBookExtractionAi && api.executeGlobalBookExtractionAi && api.getGlobalBookExtractionAiResult && api.cancelGlobalBookExtractionAi && <GlobalBookExtractionAiPanel key={preview.token} api={{ prepareGlobalBookExtractionAi: api.prepareGlobalBookExtractionAi, executeGlobalBookExtractionAi: api.executeGlobalBookExtractionAi, getGlobalBookExtractionAiResult: api.getGlobalBookExtractionAiResult, cancelGlobalBookExtractionAi: api.cancelGlobalBookExtractionAi }} library={library} preview={preview} permission={permission} disabled={busy || pendingReceipt} batches={batches} onBusyChange={setAiBusy} onUse={item => {
        if (reviews[item.segmentId]?.status === 'committed') { setError('该段已经入库，请勿重复审核。'); return; }
        update(item.segmentId, { body: item.excerpt, categoryId: item.categoryId, tagIds: item.tagIds, annotation: { technique: item.technique, usage: item.usage, exercise: item.exercise }, status: 'pending' });
        setPage(Math.floor(preview.segments.findIndex(segment => segment.id === item.segmentId) / 20)); setMessage('AI 建议已带入学习卡，请核对原句和讲解并逐条审核。');
      }} />}
      <div className="book-extraction-columns"><section className="book-extraction-reader" aria-label="原文阅读"><header><h2>原文阅读</h2><span>第 {page + 1} 页</span></header><div className="book-extraction-reader-scroll">{preview.segments.slice(page * 20, (page + 1) * 20).map(segment => <article key={segment.id}><small>{segment.chapterTitle} · 原文第 {segment.paragraphIndex} 段</small><p>{segment.text}</p></article>)}</div></section>
      <section className="book-extraction-review" aria-label="全局摘选审核"><header><h2>摘选与学习卡</h2><span>默认不入库</span></header><div className="book-extraction-review-scroll">{preview.segments.slice(page * 20, (page + 1) * 20).map(segment => {
        const item = reviews[segment.id]; if (!item) return null;
        return <fieldset key={segment.id} disabled={busy || aiBusy || pendingReceipt || item.status === 'committed'}><legend>{segment.chapterTitle} · 第 {segment.paragraphIndex} 段{item.status === 'committed' ? ' · 已入库' : ''}</legend>
          <label>原句短摘录<textarea value={item.body} maxLength={20000} onChange={event => update(segment.id, { body: event.target.value, status: 'pending' })} /></label><small>只可截取原文中连续出现的文字，不可改写为原著。</small>
          {(['technique', 'usage', 'exercise'] as const).map((field, index) => <label key={field}>{['写作手法', '适用场景', '仿写练习'][index]}<textarea value={item.annotation?.[field] ?? ''} maxLength={20000} onChange={event => update(segment.id, { annotation: { ...(item.annotation ?? blankAnnotation), [field]: event.target.value }, status: 'pending' })} /></label>)}
          <label>分类<SelectField value={item.categoryId} onChange={event => update(segment.id, { categoryId: event.target.value, status: 'pending' })}>{categories.map(category => <option key={category.id} value={category.id}>{extractionCategoryPath(categories, category.id)}</option>)}</SelectField></label>
          <div className="book-extraction-tags">{tags.map(tag => <label key={tag.id}><input type="checkbox" checked={item.tagIds.includes(tag.id)} onChange={event => update(segment.id, { tagIds: event.target.checked ? [...item.tagIds, tag.id] : item.tagIds.filter(id => id !== tag.id), status: 'pending' })} />{tag.name}</label>)}</div>
          <label><input type="checkbox" checked={item.status === 'approved' || item.status === 'committed'} disabled={!item.body.trim() || !segment.text.includes(item.body.trim()) || !categories.some(category => category.id === item.categoryId)} onChange={event => update(segment.id, { status: event.target.checked ? 'approved' : 'pending' })} />已逐字核对，审核入库</label>
        </fieldset>;
      })}</div></section></div><footer className="book-extraction-footer"><button disabled={busy || !page} onClick={() => setPage(value => value - 1)}>上一页</button><span>第 {page + 1} / {Math.ceil(preview.segments.length / 20)} 页</span><button disabled={busy || (page + 1) * 20 >= preview.segments.length} onClick={() => setPage(value => value + 1)}>下一页</button><button className="primary" disabled={busy || aiBusy || pendingReceipt || !permission || !selected.length || !sourceTitle.trim() || rights === 'public-excerpt' && (!author.trim() || !chapter.trim())} onClick={() => void commit()}>确认加入全局库（{selected.length}）</button></footer></>}
    <AnimatePresence>{confirmRender && <StructureDialog busy={busy} onClose={() => setConfirmRender(false)} state={{ heading: '确认受限网页渲染', submitLabel: '确认渲染', submitTone: 'primary', onSubmit: async () => { setConfirmRender(false); void source('restricted-browser'); return true; } }}><p>将联网执行该网页的脚本，在隔离和时间上限内提取可见正文。不会登录、点击或绕过验证码。</p><p>{url}</p></StructureDialog>}</AnimatePresence>
    <AnimatePresence>{discard && <StructureDialog busy={busy} onClose={() => setDiscard(false)} state={{ heading: '更换全局拆书素材？', description: '未入库草稿将删除；已审核入库的短摘录继续保留。', submitLabel: '更换素材', onSubmit: async () => {
      if (!preview) return true; try { await api.discardGlobalExtractionDraft(preview.token); setPreview(null); setReviews({}); setDiscard(false); return true; }
      catch (failure) { setError(failure instanceof Error ? failure.message : '草稿清理失败。'); return false; }
    } }} />}</AnimatePresence>
  </section>;
}

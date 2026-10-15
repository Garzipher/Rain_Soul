import { AnimatePresence, m } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AssetAction, AssetState } from '../../shared/assets';
import type { GlobalKnowledgeAction, GlobalKnowledgeApi, GlobalKnowledgePage } from '../../shared/global-knowledge';
import { isDefiniteRejection } from '../../shared/operation-errors';
import { globalArchiveApi, readGlobalDictionary } from '../lib/global-knowledge-settings';
import { KnowledgeDictionary } from './knowledge-dictionary';

export interface GlobalKnowledgeSettingsState {
  page: GlobalKnowledgePage | null;
  busy: boolean;
  error?: string;
  onAction: (action: GlobalKnowledgeAction) => Promise<boolean>;
  onAccept: (page: GlobalKnowledgePage) => void;
}

interface Props extends GlobalKnowledgeSettingsState {
  api: Partial<GlobalKnowledgeApi>;
  locked: boolean;
  onDirtyChange: (dirty: boolean) => void;
}
type ArchivePreview = NonNullable<Awaited<ReturnType<GlobalKnowledgeApi['chooseGlobalKnowledgeArchive']>>>;

export function GlobalKnowledgeSettings({ api, page, busy, error, locked, onAction, onAccept, onDirtyChange }: Props) {
  const archive = useMemo(() => globalArchiveApi(api), [api]);
  const [dictionary, setDictionary] = useState<GlobalKnowledgePage | null>(null);
  const [loading, setLoading] = useState(false), [epoch, setEpoch] = useState(0);
  const [localError, setError] = useState(''), [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<ArchivePreview | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false), [uncertain, setUncertain] = useState(false);
  const [dictionaryDirty, setDictionaryDirty] = useState(false);
  const pending = useRef<{ token: string; operationId: string } | null>(null), operation = useRef(false);
  const dirtyCallback = useRef(onDirtyChange); dirtyCallback.current = onDirtyChange;
  const dirty = archiveBusy || uncertain || dictionaryDirty || preview !== null;
  useEffect(() => { dirtyCallback.current(dirty); }, [dirty]);
  useEffect(() => () => dirtyCallback.current(false), []);
  useEffect(() => {
    let active = true;
    if (!api.readGlobalKnowledge) return;
    setLoading(true); setError('');
    void readGlobalDictionary({ readGlobalKnowledge: query => api.readGlobalKnowledge!(query) })
      .then(value => { if (active) setDictionary(value); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : '无法读取全局分类关联。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, page?.libraryId, page?.revision, epoch]);
  const dictionaryChanged = useCallback((value: boolean) => setDictionaryDirty(value), []);
  const assets = useMemo<AssetState | null>(() => dictionary ? {
    categories: dictionary.categories, tags: dictionary.tags, knowledge: dictionary.entries,
    outlines: [], foreshadows: [], evidence: [], styleProfiles: [], chapterStyles: [], defaultStyleId: null,
  } : null, [dictionary]);
  const disabled = busy || locked || archiveBusy;
  async function mutate(action: AssetAction) {
    switch (action.type) {
      case 'createCategory': case 'updateCategory': case 'moveCategory': case 'deleteCategory': case 'createTag': case 'deleteTag': {
        const success = await onAction(action);
        if (success) setEpoch(value => value + 1);
        return success;
      }
      default: throw new Error('全局字典只接受分类和标签操作。');
    }
  }
  async function choose() {
    if (!archive || operation.current || disabled || dictionaryDirty || uncertain) return;
    operation.current = true; setArchiveBusy(true); setError(''); setNotice('');
    try { setPreview(await archive.chooseGlobalKnowledgeArchive()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法读取全局归档。'); }
    finally { operation.current = false; setArchiveBusy(false); }
  }
  async function confirm() {
    if (!archive || !preview || operation.current || disabled) return;
    const request = pending.current ?? { token: preview.token, operationId: crypto.randomUUID() };
    pending.current = request; operation.current = true; setArchiveBusy(true); setError(''); setNotice('');
    try {
      const result = await archive.confirmGlobalKnowledgeArchive(request);
      pending.current = null; setUncertain(false); setPreview(null); onAccept(result);
      setEpoch(value => value + 1); setNotice('全局知识归档已导入，原有条目已保留。');
    } catch (reason) {
      const rejected = isDefiniteRejection(reason);
      if (rejected) pending.current = null;
      setUncertain(!rejected);
      setError(`${reason instanceof Error ? reason.message : '导入未完成。'}${rejected ? '' : ' 导入结果尚未核实，请点击“核实并重试导入”；重复请求不会重复入库。'}`);
    } finally { operation.current = false; setArchiveBusy(false); }
  }
  async function exportArchive() {
    if (!archive || operation.current || disabled || dictionaryDirty || preview) return;
    operation.current = true; setArchiveBusy(true); setError(''); setNotice('');
    try { if (await archive.exportGlobalKnowledgeArchive()) setNotice('全局知识库已导出。'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法导出全局知识库。'); }
    finally { operation.current = false; setArchiveBusy(false); }
  }
  return <section className="global-knowledge-settings" aria-label="全局知识库设置">
    <h2>全局知识库</h2><p>所有作品共用，单独保存分类、标签和知识。作品备份不会包含整个全局库。</p>
    {!api.readGlobalKnowledge && <p role="status">当前版本未提供全局知识库接口。</p>}
    {assets && <KnowledgeDictionary assets={assets} busy={disabled || loading || !!localError || preview !== null} onAction={mutate} onDirtyChange={dictionaryChanged} />}
    {loading && <p role="status">正在读取全局分类和条目关联…</p>}
    <div className="global-archive-settings"><h3>独立归档</h3><p>使用 .rainsoulknowledge 文件备份或迁入全局知识。导入会生成新的条目身份，不覆盖已有条目，也不会更改作品中的来源副本。</p>
      <div className="global-archive-actions"><button className="secondary" disabled={disabled || dictionaryDirty || !!preview || !archive} onClick={() => void exportArchive()}>导出全局知识库</button><button className="secondary" disabled={disabled || dictionaryDirty || !!preview || !archive} onClick={() => void choose()}>导入全局知识库</button></div>
      {!archive && <p role="status">当前版本未提供独立归档接口。</p>}
      <AnimatePresence initial={false}>{preview && <m.div key="global-archive-preview" className="global-archive-preview" role="group" aria-label="确认全局知识归档" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
        <h4>导入预览</h4><p>{preview.filename} · {preview.count} 条知识</p><p>文件校验已完成。确认后将作为新的导入批次写入全局库。</p>
        {uncertain && <p role="status">前一次导入结果尚未核实。请重试同一次操作，核实完成后可继续其他操作。</p>}
        <div className="global-archive-actions"><button className="secondary" disabled={disabled || uncertain} onClick={() => { setPreview(null); pending.current = null; setError(''); }}>取消导入</button><button className="primary" disabled={disabled} onClick={() => void confirm()}>{archiveBusy ? '正在处理…' : uncertain ? '核实并重试导入' : '确认导入'}</button></div>
      </m.div>}</AnimatePresence>
    </div>
    {(localError || error) && <p role="alert">{localError || error}{!uncertain && <button className="secondary" disabled={disabled || dictionaryDirty || !!preview} onClick={() => setEpoch(value => value + 1)}>重新读取</button>}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}

import type { GlobalSourceStarter } from '../../shared/global-source-starter';

interface Props { sources: readonly GlobalSourceStarter[]; disabled: boolean; onSelect(source: GlobalSourceStarter): void }

/** 展示已核实的短摘录入口；点击后进入本机预览，绝不直接写入正式库。 */
export function GlobalSourceStarterPanel({ sources, disabled, onSelect }: Props) {
  return <section className="book-extraction-starters" aria-label="首批核实素材">
    <div className="book-extraction-starters-heading"><div><h2>首批核实素材</h2><p>来自可公开读取的官方章节，仅保留短摘录；点击后进入逐条审核。</p></div><span>默认不入库</span></div>
    <div className="book-extraction-starter-list">{sources.map(source => <article key={source.id} className="book-extraction-starter">
      <div><h3>{source.workTitle}</h3><p>{source.author} · {source.chapter}{source.alternateTitle ? ` · ${source.alternateTitle}` : ''}</p>
        <small>页面指标：{source.metrics.map(metric => `${metric.label} ${metric.value}`).join(' · ')}</small></div>
      <div className="book-extraction-starter-actions"><a href={source.chapterUrl} target="_blank" rel="noreferrer">打开章节来源</a><button disabled={disabled} onClick={() => onSelect(source)}>载入预览</button></div>
    </article>)}</div>
  </section>;
}

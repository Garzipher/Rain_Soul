export interface PlaceholderProps { title?: string; deferred?: boolean; onReturn: () => void }

export function Placeholder({ title, deferred = false, onReturn }: PlaceholderProps) {
  return <section className="placeholder" aria-label={title}>
    <span className="placeholder-mark" aria-hidden="true">◇</span>
    <h2>{deferred ? '后续开发：本功能尚未交付' : '开发中：本功能尚未交付'}</h2>
    <p>{deferred ? '此入口保留已确认的交互方向，待独立评估后开发。' : '当前正在交付本地写作基础，完整主流程将按计划逐批实现。'}</p>
    <button className="secondary" onClick={onReturn}>返回作品集</button>
  </section>;
}

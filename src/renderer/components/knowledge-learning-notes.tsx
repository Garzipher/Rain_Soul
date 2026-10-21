import type { LearningNote } from '../../shared/assets';

export function KnowledgeLearningNotes({ notes, referenceAvailable }: { notes: LearningNote[]; referenceAvailable: boolean }) {
  if (!notes.length) return null;
  return <section className="knowledge-learning-notes" aria-label="学习注释">
    <h3>学习注释</h3>
    {notes.map((note, index) => <dl key={index}>
      {note.technique && <><dt>写作手法</dt><dd>{note.technique}</dd></>}
      {note.usage && <><dt>适用场景</dt><dd>{note.usage}</dd></>}
      {note.exercise && <><dt>仿写练习</dt><dd>{note.exercise}</dd></>}
    </dl>)}
    {referenceAvailable && <small>选作参考时附带学习注释，供 AI 借鉴写法；原句与讲解保持区分。</small>}
  </section>;
}
export function KnowledgeLearningEditor({ notes, disabled, onChange }: { notes: LearningNote[]; disabled: boolean; onChange: (notes: LearningNote[]) => void }) {
  const fields = [{ key: 'technique', name: '写作手法' }, { key: 'usage', name: '适用场景' }, { key: 'exercise', name: '仿写练习' }] as const;
  return <section className="knowledge-learning-editor" aria-label="编辑学习注释">
    <h3>学习注释</h3><p>记录自己的理解与仿写练习，与摘录原文分开保存。</p>
    {notes.map((note, index) => <fieldset key={index} disabled={disabled}>
      <legend>学习注释 {index + 1}</legend>
      {fields.map(field => <label key={field.key}>{field.name} {index + 1}<textarea maxLength={20000} value={note[field.key]} onChange={event => onChange(notes.map((item, position) => position === index ? { ...item, [field.key]: event.target.value } : item))} /></label>)}
      <button type="button" className="secondary" aria-label={`移除学习注释 ${index + 1}`} onClick={() => onChange(notes.filter((_, position) => position !== index))}>移除这条注释</button>
    </fieldset>)}
    <button type="button" className="secondary" disabled={disabled || notes.length >= 100} onClick={() => onChange([...notes, { technique: '', usage: '', exercise: '' }])}>添加学习注释</button>
  </section>;
}

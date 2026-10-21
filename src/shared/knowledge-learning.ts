import type { KnowledgeEntry, LearningNote } from './assets';

/** 教学说明始终有明确标签，不能混作摘录原文或灰字补全内容。 */
export function learningNoteText(notes: readonly LearningNote[] = []): string {
  return notes.map(note => [
    note.technique ? `写作手法：${note.technique}` : '',
    note.usage ? `适用场景：${note.usage}` : '',
    note.exercise ? `仿写练习：${note.exercise}` : '',
  ].filter(Boolean).join('\n')).filter(Boolean).join('\n\n');
}
export function knowledgeSearchText(entry: Pick<KnowledgeEntry, 'body' | 'learningNotes'>): string {
  const notes = learningNoteText(entry.learningNotes);
  return notes ? `${entry.body}\n作者审核学习注释：\n${notes}` : entry.body;
}

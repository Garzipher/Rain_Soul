import type { Node } from '@tiptap/pm/model';
import type { AiOperation } from '../../shared/ai';

export interface WritingAiSelection { paragraphIds: string[]; text: string; sentenceFrom?: number }
export interface WritingAiRequest extends WritingAiSelection { operation: AiOperation; token: number }
const leafText = (node: Node) => node.type.name === 'hardBreak' ? '\n' : '';

/** 右键抢走焦点之前，冻结正文选区身份；书签不参与正文偏移。 */
export function captureWritingSelection(doc: Node, from: number, to: number): WritingAiSelection | null {
  if (from >= to || from < 0 || to > doc.content.size) return null;
  const paragraphs: { id: string; node: Node; position: number }[] = [];
  doc.forEach((node, position) => {
    if (node.type.name === 'paragraph' && from < position + node.nodeSize - 1 && to > position + 1) paragraphs.push({ id: node.attrs.id, node, position });
  });
  const text = doc.textBetween(from, to, '\n', leafText);
  if (!paragraphs.length || !text.trim()) return null;
  const first = paragraphs[0];
  const sentenceFrom = paragraphs.length === 1 && !text.includes('\n') ? first.node.textBetween(0, Math.max(0, from - first.position - 1), '', leafText).length : undefined;
  return { paragraphIds: paragraphs.map(item => item.id), text, ...(sentenceFrom !== undefined ? { sentenceFrom } : {}) };
}

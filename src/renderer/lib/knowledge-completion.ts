import type { KnowledgeEntry } from '../../shared/assets';
export interface KnowledgeCompletion { knowledgeId: string; revision: number; prefix: string; suffix: string; source: string }
const MAX_SCAN = 200_000;
const MAX_SUFFIX = 160;

/** 只从已保存的知识原句生成确定性的前缀提示，不调用模型也不改正文。 */
export function findKnowledgeCompletion(prefix: string, entries: KnowledgeEntry[]): KnowledgeCompletion | null {
  if (!prefix || prefix.length > MAX_SCAN || /\s$/u.test(prefix) || /^(?:\p{P}|\p{S})+$/u.test(prefix)) return null;
  const fragment = prefix.slice(prefix.search(/[^。！？!?；;：:.，,\n]*$/u)).trimStart();
  if (!fragment || Array.from(fragment).length < 2) return null;
  if (/^[a-zA-Z0-9]+$/u.test(fragment) && fragment.length < 3) return null;
  let budget = MAX_SCAN;
  const candidates = entries.filter(entry => { if (entry.deletedAt || entry.body.length > budget) return false; budget -= entry.body.length; return true; })
    .map(entry => {
      const sentences = entry.body.split(/(?<=[。！？!?；;：:.])|\n/u).map(part => part.trimStart());
      let sentence = '', matched = '';
      for (const part of sentences) {
        // 当前句中已写有衔接语时，仍可由尾部的知识原句前缀触发；不从知识原句中间抄起。
        for (let length = Math.min(fragment.length, part.length, 160); length >= 2; length--) {
          const start = part.slice(0, length);
          if (!fragment.endsWith(start) || /^[a-zA-Z0-9]+$/u.test(start) && (length < 3 || /[a-zA-Z0-9]$/u.test(fragment.slice(0, -length)))) continue;
          if (length > matched.length) { sentence = part; matched = start; }
          break;
        }
      }
      const suffix = matched ? sentence.slice(matched.length) : '';
      return { candidate: { knowledgeId: entry.id, revision: entry.revision, prefix, suffix: Array.from(suffix).slice(0, MAX_SUFFIX).join(''), source: entry.source.trim() || '未注明' }, length: matched.length };
    })
    .filter(item => item.candidate.suffix.length > 0)
    .sort((left, right) => right.length - left.length || left.candidate.knowledgeId.localeCompare(right.candidate.knowledgeId));
  return candidates[0]?.candidate ?? null;
}

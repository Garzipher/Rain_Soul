import type { KnowledgeEntry } from '../../shared/assets';
export interface KnowledgeCompletion { knowledgeId: string; revision: number; prefix: string; suffix: string; source: string }
const MAX_SCAN = 200_000;
const MAX_SUFFIX = 160;

/** 只从已保存的知识原句生成确定性的前缀提示，不调用模型也不改正文。 */
export function findKnowledgeCompletion(prefix: string, entries: KnowledgeEntry[]): KnowledgeCompletion | null {
  if (!prefix || prefix.length > MAX_SCAN || /\s$/u.test(prefix) || /^(?:\p{P}|\p{S})+$/u.test(prefix)) return null;
  const fragment = prefix.slice(prefix.search(/[^。！？!?；;：:.\n]*$/u));
  if (!fragment || Array.from(fragment).length < 2) return null;
  if (/^[a-zA-Z0-9]+$/u.test(fragment) && fragment.length < 3) return null;
  let budget = MAX_SCAN;
  const candidates = entries.filter(entry => { if (entry.deletedAt || entry.body.length > budget) return false; budget -= entry.body.length; return true; })
    .map(entry => {
      const sentence = entry.body.split(/(?<=[。！？!?；;：:.])|\n/u).map(part => part.trimStart()).find(part => part.startsWith(fragment)) ?? '';
      const suffix = sentence.slice(fragment.length);
      return { knowledgeId: entry.id, revision: entry.revision, prefix, suffix: Array.from(suffix).slice(0, MAX_SUFFIX).join(''), source: entry.source.trim() || '未注明' };
    })
    .filter(candidate => candidate.suffix.length > 0)
    .sort((left, right) => left.knowledgeId.localeCompare(right.knowledgeId));
  return candidates[0] ?? null;
}

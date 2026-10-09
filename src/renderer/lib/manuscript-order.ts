import type { ManuscriptChapter } from '../../shared/manuscript';

/** 与导入落盘一致：无卷在前，分卷按首次出现排列，同卷章节保持原相对顺序。 */
export function normalizeManuscriptOrder(chapters: ManuscriptChapter[]): ManuscriptChapter[] {
  const unvolumed: ManuscriptChapter[] = [], volumes = new Map<string, ManuscriptChapter[]>();
  for (const chapter of chapters) {
    const volumeTitle = chapter.volumeTitle?.trim() || null;
    const normalized = volumeTitle === chapter.volumeTitle ? chapter : { ...chapter, volumeTitle };
    if (volumeTitle === null) unvolumed.push(normalized);
    else {
      if (!volumes.has(volumeTitle)) volumes.set(volumeTitle, []);
      volumes.get(volumeTitle)!.push(normalized);
    }
  }
  return [...unvolumed, ...Array.from(volumes.values()).flat()];
}

export function canMoveManuscriptChapter(chapters: ManuscriptChapter[], index: number, offset: -1 | 1): boolean {
  const chapter = chapters[index], neighbor = chapters[index + offset];
  return !!chapter && !!neighbor && (chapter.volumeTitle?.trim() || null) === (neighbor.volumeTitle?.trim() || null);
}

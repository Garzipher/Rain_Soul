import type { Evidence, Foreshadow, KnowledgeEntry } from './assets';

/** 解析草稿只描述内容，不拥有作品身份；确认导入时另建新作品。 */
export interface ManuscriptChapter { title: string; volumeTitle: string | null; paragraphs: string[] }
export interface ManuscriptWarning { code: string; message: string; count: number }
export interface ManuscriptDraft {
  title: string;
  format: 'txt' | 'docx';
  encoding: string | null;
  chapters: ManuscriptChapter[];
  warnings: ManuscriptWarning[];
}
export interface ManuscriptOptions { title: string; encoding?: 'utf-8' | 'gb18030'; maxInputBytes?: number }
export interface ManuscriptBlock { text: string; headingLevel?: number }

export type ExportInline = { type: 'text'; text: string } | { type: 'hardBreak' } | {
  type: 'bookmark'; attrs: { id: string; kind: 'knowledge' | 'foreshadow'; targetId: string };
};
export interface ExportChapter {
  id: string; title: string;
  document: { type: 'doc'; content: { type: 'paragraph'; attrs: { id: string }; content?: ExportInline[] }[] };
}
/** 调用方先冻结同一 revision 的正文和素材；导出层不访问数据库。 */
export interface ExportManuscript {
  title: string; revision: number;
  volumes: { title: string; chapters: ExportChapter[] }[];
  unvolumedChapters: ExportChapter[];
  knowledge: Pick<KnowledgeEntry, 'id' | 'body' | 'source' | 'deletedAt'>[];
  foreshadows: Foreshadow[];
  evidence: Evidence[];
}

export type ManuscriptExportMode = 'clean' | 'full';

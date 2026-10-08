export interface TextNode { type: 'text'; text: string }
export interface HardBreakNode { type: 'hardBreak' }
export interface ParagraphNode {
  type: 'paragraph';
  attrs: { id: string };
  content?: (TextNode | HardBreakNode)[];
}
export interface WritingDocument { type: 'doc'; content: ParagraphNode[] }
export interface WorkSummary {
  id: string;
  title: string;
  wordCount: number;
  chapterCount: number;
  updatedAt: string;
}
export interface Chapter {
  id: string;
  title: string;
  document: WritingDocument;
  wordCount: number;
}
export interface WorkDetail { id: string; title: string; revision: number; chapters: Chapter[] }
export interface SaveResult { revision: number; wordCount: number }
export interface RuntimeInfo { version: string; dataDirectory: string }
export interface DesktopApi {
  listWorks(): Promise<WorkSummary[]>;
  createWork(title: string): Promise<WorkDetail>;
  openWork(id: string): Promise<WorkDetail>;
  addChapter(workId: string, title: string, expectedRevision: number, operationId: string): Promise<WorkDetail>;
  saveChapter(workId: string, chapterId: string, title: string, document: WritingDocument, expectedRevision: number, operationId: string): Promise<SaveResult>;
  getRuntimeInfo(): Promise<RuntimeInfo>;
  onCloseRequested(handler: () => Promise<void>): () => void;
}

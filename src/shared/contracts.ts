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
  volumeId: string | null;
}
export interface Volume { id: string; title: string }
export interface DeletedItem { id: string; kind: 'chapter' | 'volume'; title: string; deletedAt: string }
export interface WorkDetail { id: string; title: string; revision: number; chapters: Chapter[]; volumes: Volume[]; deletedItems: DeletedItem[] }
export interface DeletedWork extends WorkSummary { revision: number }
export type StructureAction =
  | { type: 'createVolume'; title: string }
  | { type: 'renameWork'; title: string }
  | { type: 'renameVolume'; volumeId: string; title: string }
  | { type: 'moveVolume'; volumeId: string; direction: 'up' | 'down' }
  | { type: 'moveChapter'; chapterId: string; direction: 'up' | 'down' }
  | { type: 'setChapterVolume'; chapterId: string; volumeId: string | null }
  | { type: 'deleteVolume' | 'restoreVolume'; volumeId: string }
  | { type: 'deleteChapter' | 'restoreChapter'; chapterId: string }
  | { type: 'deleteWork' | 'restoreWork' };
export interface StructureRequest { workId: string; expectedRevision: number; operationId: string; action: StructureAction }
export interface SaveResult { revision: number; wordCount: number }
export interface RuntimeInfo { version: string; dataDirectory: string }
export interface DesktopApi {
  listWorks(): Promise<WorkSummary[]>;
  createWork(title: string): Promise<WorkDetail>;
  openWork(id: string): Promise<WorkDetail>;
  addChapter(workId: string, title: string, expectedRevision: number, operationId: string, volumeId?: string | null): Promise<WorkDetail>;
  saveChapter(workId: string, chapterId: string, title: string, document: WritingDocument, expectedRevision: number, operationId: string): Promise<SaveResult>;
  getRuntimeInfo(): Promise<RuntimeInfo>;
  onCloseRequested(handler: () => Promise<void>): () => void;
}

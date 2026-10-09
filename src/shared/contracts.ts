import type { AiKnowledgeApproval } from './ai-extraction';
export interface TextNode { type: 'text'; text: string }
export interface HardBreakNode { type: 'hardBreak' }
export interface BookmarkNode { type: 'bookmark'; attrs: { id: string; kind: 'knowledge' | 'foreshadow'; targetId: string } }
export interface ParagraphNode {
  type: 'paragraph';
  attrs: { id: string };
  content?: (TextNode | HardBreakNode | BookmarkNode)[];
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
export interface WorkDetail { id: string; title: string; revision: number; chapters: Chapter[]; volumes: Volume[]; deletedItems: DeletedItem[]; assets?: AssetState }
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
export interface SaveResult { revision: number; wordCount: number; assets?: AssetState }
export interface RuntimeInfo { version: string; dataDirectory: string }
export interface DesktopApi {
  getAiSettings(): Promise<{ provider: AiProvider | null; hasCredential: boolean }>;
  saveAiSettings(provider: AiProvider, key?: string): Promise<{ provider: AiProvider | null; hasCredential: boolean }>;
  clearAiSettings(): Promise<{ provider: AiProvider | null; hasCredential: boolean }>;
  prepareAi(request: { workId: string; chapterId: string; operation: AiOperation; scope: 'chapter' | 'previous' | 'volume' | 'custom'; chapterIds?: string[]; instruction?: string; targetParagraphIds?: string[]; sentenceText?: string; referenceKnowledgeIds?: string[] }): Promise<AiPreparedRequest>;
  executeAi(request: AiExecuteRequest): Promise<AiCandidate>;
  cancelAi(confirmationToken: string): Promise<void>;
  applyAiCandidate(request: { workId: string; candidateId: string; operationId: string }): Promise<WorkDetail>;
  approveAiKnowledge(request: { workId: string; candidateId: string; operationId: string; items: AiKnowledgeApproval[] }): Promise<WorkDetail>;
  chooseProjectArchive(): Promise<{ token: string; filename: string; schemaVersion: number } | null>;
  confirmProjectArchive(request: { token: string; operationId: string }): Promise<WorkDetail>;
  exportProjectArchive(workId: string): Promise<boolean>;
  chooseManuscript(encoding: 'utf-8' | 'gb18030'): Promise<{ token: string; draft: ManuscriptDraft } | null>;
  confirmManuscript(request: { token: string; operationId: string; draft: ManuscriptDraft }): Promise<WorkDetail>;
  exportManuscript(workId: string, format: 'txt' | 'docx', snapshotId?: string): Promise<boolean>;
  getAuthorProfile(): Promise<AuthorProfile>;
  setPenName(penName: string): Promise<AuthorProfile>;
  chooseAvatar(): Promise<AuthorProfile>;
  clearAvatar(): Promise<AuthorProfile>;
  listWorks(): Promise<WorkSummary[]>;
  createWork(title: string): Promise<WorkDetail>;
  openWork(id: string): Promise<WorkDetail>;
  addChapter(workId: string, title: string, expectedRevision: number, operationId: string, volumeId?: string | null): Promise<WorkDetail>;
  saveChapter(workId: string, chapterId: string, title: string, document: WritingDocument, expectedRevision: number, operationId: string): Promise<SaveResult>;
  getRuntimeInfo(): Promise<RuntimeInfo>;
  manageStructure(request: StructureRequest): Promise<WorkDetail | null>;
  manageAssets(request: AssetRequest): Promise<WorkDetail>;
  searchWork(workId: string, query: AssetQuery): Promise<SearchResult[]>;
  readKnowledgeScope(scopeId: string | null): Promise<KnowledgeScope>;
  searchKnowledgeScope(scopeId: string | null, query: AssetQuery): Promise<KnowledgeScopeResult[]>;
  copyKnowledge(request: KnowledgeCopyRequest): Promise<WorkDetail>;
  listSnapshots(workId: string): Promise<SnapshotSummary[]>;
  previewSnapshot(workId: string, snapshotId: string): Promise<SnapshotPreview>;
  createSnapshot(request: SnapshotCreateRequest): Promise<WorkDetail>;
  restoreSnapshot(request: SnapshotRestoreRequest): Promise<WorkDetail>;
  listDeletedWorks(): Promise<DeletedWork[]>;
  onCloseRequested(handler: () => Promise<void>): () => void;
}
import type { AuthorProfile } from './profile';
import type { ManuscriptDraft } from './manuscript';
import type { AiProvider, AiOperation, AiPreparedRequest, AiExecuteRequest, AiCandidate } from './ai';
import type { AssetRequest, AssetState, AssetQuery, SearchResult } from './assets';
import type { KnowledgeScope, KnowledgeScopeResult, KnowledgeCopyRequest } from './knowledge-scope';
import type { SnapshotSummary, SnapshotPreview, SnapshotCreateRequest, SnapshotRestoreRequest } from './snapshots';

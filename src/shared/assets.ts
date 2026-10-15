export type OutlineKind = 'volume' | 'chapter' | 'detail';
export type ForeshadowStatus = '未埋设' | '已埋设' | '已触发' | '已回收' | '废弃';
export type EvidenceKind = '埋设' | '触发' | '回收';
export interface OutlineNode { id: string; type: OutlineKind; parentId: string | null; title: string; summary: string; chapterId: string | null; knowledgeIds: string[]; sortOrder: number; deletedAt: string | null }
export interface Foreshadow { id: string; name: string; status: ForeshadowStatus; description: string; outlineId: string | null; deletedAt: string | null }
export interface EvidenceSource { chapterId: string; chapterTitle: string; paragraphId: string | null; excerpt: string; revision: number }
export interface Evidence { id: string; foreshadowId: string; kind: EvidenceKind; chapterId: string; paragraphId: string | null; excerpt: string; sourceRevision: number; originalSource: EvidenceSource; supersedesId: string | null; supersededBy: string | null; deletedAt: string | null; valid: boolean; invalidReason: string | null }
export interface Category { id: string; name: string; parentId: string | null; sortOrder: number; systemKey: string | null; deletedAt: string | null }
export interface KnowledgeTag { id: string; name: string; deletedAt: string | null }
export interface KnowledgeOrigin { workId: string; entryId: string; sourceRevision: number; workTitle: string }
export interface KnowledgeEntry { id: string; body: string; source: string; categoryId: string; tagIds: string[]; origin: KnowledgeOrigin | null; globalOrigin?: import('./global-work-copy').GlobalKnowledgeOrigin; revision: number; deletedAt: string | null }
export interface StylePayload { narrativePerson: string; pace: string; prohibited: string[]; referenceWorks: string[] }
export interface StyleProfile { id: string; version: number; payload: StylePayload; createdAt: string }
export interface ChapterStyle { chapterId: string; profileId: string }
export interface AssetState { outlines: OutlineNode[]; foreshadows: Foreshadow[]; evidence: Evidence[]; categories: Category[]; tags: KnowledgeTag[]; knowledge: KnowledgeEntry[]; styleProfiles: StyleProfile[]; chapterStyles: ChapterStyle[]; defaultStyleId: string | null }
export type AssetAction =
  | { type: 'createOutline'; kind: OutlineKind; parentId: string | null; title: string }
  | { type: 'updateOutline'; id: string; title: string; summary: string; chapterId: string | null }
  | { type: 'moveOutline'; id: string; direction: 'up' | 'down' }
  | { type: 'deleteOutline'; id: string }
  | { type: 'setOutlineKnowledge'; id: string; knowledgeIds: string[] }
  | { type: 'assignForeshadows'; id: string; foreshadowIds: string[] }
  | { type: 'createForeshadow'; name: string }
  | { type: 'updateForeshadow'; id: string; name: string; status: ForeshadowStatus; description: string; outlineId: string | null }
  | { type: 'deleteForeshadow' | 'restoreForeshadow'; id: string }
  | { type: 'addEvidence'; foreshadowId: string; kind: EvidenceKind; chapterId: string; paragraphId: string | null; excerpt: string }
  | { type: 'relinkEvidence'; id: string; chapterId: string; paragraphId: string | null; excerpt: string }
  | { type: 'deleteEvidence'; id: string }
  | { type: 'createCategory'; name: string; parentId: string | null }
  | { type: 'updateCategory'; id: string; name: string; parentId: string | null }
  | { type: 'moveCategory'; id: string; direction: 'up' | 'down' }
  | { type: 'deleteCategory'; id: string; destinationId: string | null }
  | { type: 'createTag'; name: string }
  | { type: 'deleteTag'; id: string }
  | { type: 'createKnowledge'; body: string; source: string; categoryId: string; tagIds: string[] }
  | { type: 'updateKnowledge'; id: string; body: string; source: string; categoryId: string; tagIds: string[] }
  | { type: 'deleteKnowledge'; id: string }
  | { type: 'publishStyle'; payload: StylePayload }
  | { type: 'setChapterStyle'; chapterId: string; profileId: string | null };
export interface AssetRequest { workId: string; expectedRevision: number; operationId: string; action: AssetAction }
export interface AssetQuery { text: string; mode: 'knowledge' | 'all'; categoryId?: string | null; tagIds?: string[]; offset?: number; limit?: number }
export interface SearchResult { id: string; kind: 'knowledge' | 'paragraph'; chapterId: string | null; paragraphId: string | null; title: string; snippet: string; source: string }

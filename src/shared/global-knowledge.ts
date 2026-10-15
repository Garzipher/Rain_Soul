import type { Category, KnowledgeEntry, KnowledgeTag } from './assets';
import type { SourceAssets, LearningAnnotation } from './source-assets';
import type { FrozenSourceDocument } from './source-document';

export type KnowledgeLibraryTarget = { kind: 'work'; workId: string } | { kind: 'global' };
export type KnowledgeReferenceScope = KnowledgeLibraryTarget | { kind: 'combined'; workId: string };
export interface GlobalEntryRef { entryId: string; revision: number }
export interface GlobalSourceMetadata {
  author: string; workTitle: string; chapter: string;
  rightsBasis: 'owned' | 'authorized' | 'public-domain' | 'open-license' | 'public-excerpt';
  capturedAt: string; verificationStatus: 'verified';
  metrics: { label: string; value: string; observedAt: string }[];
}
export interface GlobalKnowledgeEntry extends KnowledgeEntry { reviewed: true; sourceDocumentId: string | null; segmentId: string | null }
export interface GlobalKnowledgePage {
  libraryId: string; revision: number; entries: GlobalKnowledgeEntry[]; categories: Category[]; tags: KnowledgeTag[];
  annotations: LearningAnnotation[]; total: number; offset: number; limit: number;
}
export interface GlobalKnowledgeQuery { text?: string; categoryId?: string | null; tagIds?: string[]; offset?: number; limit?: number }
export type GlobalKnowledgeAction = Extract<import('./assets').AssetAction, {
  type: 'createCategory' | 'updateCategory' | 'moveCategory' | 'deleteCategory' | 'createTag' | 'deleteTag' | 'createKnowledge' | 'updateKnowledge' | 'deleteKnowledge';
}>;
export interface GlobalKnowledgeMutation { operationId: string; expectedRevision: number; action: GlobalKnowledgeAction }
export interface GlobalKnowledgeStatus { available: boolean; libraryId?: string; revision?: number; message?: string }
export interface GlobalKnowledgeFrozen {
  libraryId: string; revision: number; entries: GlobalKnowledgeEntry[]; categories: Category[]; tags: KnowledgeTag[];
  sourceAssets: SourceAssets; metadata: (GlobalSourceMetadata & { sourceDocumentId: string })[];
}
/** 只允许主进程从可信来源预览构造，不能直接暴露给 renderer。 */
export interface GlobalExtractionCommit {
  operationId: string; expectedRevision: number; sourceDocument: FrozenSourceDocument; metadata: GlobalSourceMetadata;
  items: { segmentId: string; body: string; source: string; categoryId: string; tagIds: string[]; annotation?: Pick<LearningAnnotation, 'technique' | 'usage' | 'exercise'> }[];
}
export interface GlobalKnowledgeApi {
  readGlobalKnowledge(query?: GlobalKnowledgeQuery): Promise<GlobalKnowledgePage>;
  manageGlobalKnowledge(request: GlobalKnowledgeMutation): Promise<GlobalKnowledgePage>;
  getGlobalKnowledgeStatus(): Promise<GlobalKnowledgeStatus>;
  exportGlobalKnowledgeArchive(): Promise<boolean>;
  chooseGlobalKnowledgeArchive(): Promise<{ token: string; count: number; filename: string } | null>;
  confirmGlobalKnowledgeArchive(request: { token: string; operationId: string }): Promise<GlobalKnowledgePage>;
}

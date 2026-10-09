import { z } from 'zod';

export interface SnapshotSummary { id: string; title: string; kind: 'manual' | 'safety'; createdAt: string; sourceSnapshotId: string | null; sourceRevision: number; schemaVersion: number }
export interface SnapshotPreview { summary: SnapshotSummary; title: string; chapterCount: number; volumeCount: number; wordCount: number; chapters: { id: string; title: string; wordCount: number }[]; knowledgeCount: number; foreshadowCount: number }
export interface SnapshotCreateRequest { workId: string; expectedRevision: number; operationId: string; title: string }
export interface SnapshotRestoreRequest { workId: string; expectedRevision: number; operationId: string; snapshotId: string }
export const snapshotCreateRequestSchema: z.ZodType<SnapshotCreateRequest> = z.object({ workId: z.uuid(), expectedRevision: z.number().int().positive(), operationId: z.uuid(), title: z.string().trim().min(1).max(200) }).strict();
export const snapshotRestoreRequestSchema: z.ZodType<SnapshotRestoreRequest> = z.object({ workId: z.uuid(), expectedRevision: z.number().int().positive(), operationId: z.uuid(), snapshotId: z.uuid() }).strict();

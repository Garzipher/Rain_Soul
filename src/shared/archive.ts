import { z } from 'zod';

export interface ArchiveMetadata { projectId: string; schemaVersion: number }
export interface ProjectArchiveManifest extends ArchiveMetadata { formatVersion: 1; databaseSha256: string }
export interface ProjectArchiveLimits {
  maxInputBytes?: number; maxEntries?: number; maxExpandedBytes?: number;
  maxManifestBytes?: number; maxCompressionRatio?: number;
}
export const archiveMetadataSchema = z.object({
  projectId: z.uuid(), schemaVersion: z.number().int().positive().max(0x7fffffff),
}).strict();
export const archiveManifestSchema = archiveMetadataSchema.extend({
  formatVersion: z.literal(1), databaseSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export interface ParsedProjectArchive { manifest: ProjectArchiveManifest; database: Buffer }

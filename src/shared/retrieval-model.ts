import { z } from 'zod';
import manifest from '../../assets/retrieval-model-manifest.json';

const revision = z.string().regex(/^[a-f0-9]{40}$/);
const file = z.object({
  path: z.string().regex(/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/).refine(value => !value.split('/').some(part => part === '.' || part === '..')),
  bytes: z.number().int().positive().max(512 * 1024 ** 2), sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export const retrievalModelManifestSchema = z.object({
  schemaVersion: z.literal(1), modelId: z.string().regex(/^[a-z0-9][a-z0-9.-]+$/),
  repository: z.string().regex(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/), revision,
  upstreamRepository: z.string(), upstreamReferenceRevision: revision, license: z.literal('MIT'), licenseUrl: z.url(), licenseText: z.string().min(500).max(10000),
  runtime: z.object({ transformers: z.string(), onnxruntime: z.string() }).strict(),
  dimensions: z.literal(512), windowTokens: z.literal(512), textTokens: z.literal(400),
  chunkOverlap: z.literal(50), chunkerVersion: z.literal(1), dtype: z.literal('q8'), pooling: z.literal('cls'), normalize: z.literal(true), queryPrefix: z.string().min(1),
  qualification: z.object({ officialSourceVerified: z.boolean(), conversionRevisionVerified: z.boolean(), networkAuditPassed: z.boolean(), packagedRuntimePassed: z.boolean(), qualityCalibrated: z.boolean() }).strict(),
  files: z.array(file).min(1).max(20),
}).strict().refine(value => new Set(value.files.map(item => item.path.toLowerCase())).size === value.files.length && value.files.reduce((sum, item) => sum + item.bytes, 0) <= 512 * 1024 ** 2, '模型文件重复或超过容量');
export type RetrievalModelManifest = z.infer<typeof retrievalModelManifestSchema>;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
export const fixedManifest = freeze(retrievalModelManifestSchema.parse(manifest));
/** 不依赖Node，渲染层可比较完整配置；持久缓存可对该规范字符串计算SHA256。 */
export function modelFingerprint(value: RetrievalModelManifest = fixedManifest): string {
  return JSON.stringify({ repository: value.repository, revision: value.revision, runtime: value.runtime,
    dimensions: value.dimensions, dtype: value.dtype, pooling: value.pooling, normalize: value.normalize,
    prefix: value.queryPrefix, textTokens: value.textTokens, windowTokens: value.windowTokens,
    chunkOverlap: value.chunkOverlap, chunkerVersion: value.chunkerVersion,
    files: [...value.files].sort((a, b) => a.path.localeCompare(b.path)).map(item => [item.path, item.bytes, item.sha256]) });
}
export interface RetrievalModelStatus {
  state: 'absent' | 'installing' | 'ready' | 'disabled' | 'error'; modelId: string;
  installed: boolean; qualified: boolean; fingerprint: string; bytes: number; message?: string;
}

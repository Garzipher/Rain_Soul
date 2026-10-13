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
  runtime: z.object({ tokenizers: z.literal('0.2.0'), onnxruntime: z.literal('1.31.0-dev.20260914-8d85527a0'), backend: z.literal('wasm-cpu'), implementation: z.literal(1) }).strict(),
  similarityThreshold: z.number().min(-1).max(1).nullable(),
  dimensions: z.literal(512), windowTokens: z.literal(512), textTokens: z.literal(400),
  chunkOverlap: z.literal(50), chunkerVersion: z.literal(1), dtype: z.literal('q8'), pooling: z.literal('cls'), normalize: z.literal(true), queryPrefix: z.string().min(1),
  qualification: z.object({ publicSourceRecorded: z.boolean(), officialSourceVerified: z.boolean(), conversionRevisionVerified: z.boolean(), networkAuditPassed: z.boolean(), packagedRuntimePassed: z.boolean(), qualityCalibrated: z.boolean() }).strict(),
  files: z.array(file).min(1).max(20),
}).strict().refine(value => new Set(value.files.map(item => item.path.toLowerCase())).size === value.files.length && value.files.reduce((sum, item) => sum + item.bytes, 0) <= 512 * 1024 ** 2, '模型文件重复或超过容量');
export type RetrievalModelManifest = z.infer<typeof retrievalModelManifestSchema>;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
export const fixedManifest = freeze(retrievalModelManifestSchema.parse(manifest));
/** 公开来源必须记录；官方交叉与精确转换链保留历史备注，网络、实际包及质量分别验收。 */
export function isRetrievalModelQualified(value: RetrievalModelManifest = fixedManifest): boolean {
  const checks = value.qualification;
  return checks.publicSourceRecorded && checks.networkAuditPassed && checks.packagedRuntimePassed && checks.qualityCalibrated && value.similarityThreshold !== null;
}
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
  requiredSpaceBytes?: number; availableSpaceBytes?: number;
  progress?: RetrievalModelInstallProgress | null;
  source?: 'bundled' | 'user'; bundledPresent?: boolean; enabled?: boolean; legacyDisabled?: boolean;
}
export interface RetrievalModelInstallProgress { operationId: string; source: 'local' | 'download'; phase: 'checking-space' | 'downloading' | 'copying' | 'verifying' | 'activating'; receivedBytes: number; totalBytes: number; file?: string }

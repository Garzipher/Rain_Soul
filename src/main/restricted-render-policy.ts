import { z } from 'zod';
import type { RenderCapability } from '../shared/source-capture';
export type { RenderCapability } from '../shared/source-capture';

/** 政策 v1 的共享限额不能由页面、IPC 或环境变量调整。 */
export const renderLimits = Object.freeze({
  totalTimeoutMs: 40000, initialTimeoutMs: 30000, maxRedirects: 3,
  maxRequests: 80, maxConcurrentRequests: 4,
  maxResponseCompressedBytes: 2 * 1024 * 1024, maxResponseDecodedBytes: 5 * 1024 * 1024,
  maxTotalCompressedBytes: 12 * 1024 * 1024, maxTotalDecodedBytes: 24 * 1024 * 1024,
  maxDomNodes: 20000, maxDomBytes: 5 * 1024 * 1024,
  maxBodyCharacters: 200000, maxParagraphs: 2000, quietPeriodMs: 500, maxQuietWaitMs: 5000,
  contentStableMs: 750, contentPollMs: 250,
});
const buildFields = { packageSha256: z.string().regex(/^[a-f0-9]{64}$/), electronVersion: z.string().min(1).max(100),
  platform: z.enum(['win32', 'darwin', 'linux']) };
const buildIdentitySchema = z.object(buildFields).strict();
const qualificationSchema = z.object({ ...buildFields, policyVersion: z.literal(1),
  networkIsolation: z.literal('passed'), cleanup: z.literal('passed'), realPackage: z.literal('passed'),
}).strict();

/** 纯判断函数不写入资格，也不能改变正式构建能力。 */
export function evaluateRenderCapability(evidence: unknown, identity: unknown): RenderCapability {
  const record = qualificationSchema.safeParse(evidence);
  const build = buildIdentitySchema.safeParse(identity);
  const enabled = record.success && build.success
    && record.data.packageSha256 === build.data.packageSha256
    && record.data.electronVersion === build.data.electronVersion && record.data.platform === build.data.platform;
  return { enabled, policyVersion: 1, message: enabled ? '本构建已通过受限渲染验收。' : '当前构建未通过受限渲染验收，请使用静态获取、粘贴或本地文件。' };
}

// 实际包与网络反例验收前固定为缺失；只允许后续受信构建流程生成记录。
const trustedBuildQualification = null;
const trustedBuildIdentity = null;
export function getWebRenderCapability(): RenderCapability {
  return evaluateRenderCapability(trustedBuildQualification, trustedBuildIdentity);
}

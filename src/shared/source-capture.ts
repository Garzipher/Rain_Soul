import { z } from 'zod';

const captureFields = { sourceId: z.uuid(), capturedAt: z.iso.datetime({ offset: true }), policyVersion: z.literal(1) };

/** 捕获证据只适用于网页；旧来源不补造方式或历史时间。 */
export const sourceCaptureSchema = z.discriminatedUnion('captureMethod', [
  z.object({ ...captureFields, captureMethod: z.literal('static') }).strict(),
  z.object({ ...captureFields, captureMethod: z.literal('restricted-browser'), renderedDomHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
]);
export type SourceCapture = z.infer<typeof sourceCaptureSchema>;
export interface RenderCapability { enabled: boolean; policyVersion: 1; message: string }

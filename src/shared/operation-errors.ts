/** 传递已知业务拒绝码；通信中断不能推断为未写入。 */
export function operationError(message: string, code?: string): Error & { code?: string } {
  return Object.assign(new Error(message), code ? { code } : {});
}
export function errorCode(reason: unknown): string | undefined {
  return reason instanceof Error && 'code' in reason && typeof reason.code === 'string' ? reason.code : undefined;
}
export function isDefiniteRejection(reason: unknown): boolean {
  return ['REVISION_CONFLICT', 'INVALID_INPUT', 'NOT_FOUND'].includes(errorCode(reason) ?? '');
}

// Electron contextBridge 不保证保留 Error 的自定义属性，以可识别的消息前缀传递业务码。
const bridgeCodes = new Set(['REVISION_CONFLICT', 'INVALID_INPUT', 'NOT_FOUND', 'INVALID_FILE', 'UNSUPPORTED_SCHEMA', 'MIGRATION_FAILED', 'SAVE_FAILED', 'RETRIEVAL_QUERY_TOO_LONG', 'CONVERSATION_IN_PROGRESS', 'CONVERSATION_REPLY_PENDING', 'CONVERSATION_SEND_FAILED']);
export function bridgeOperationError(message: string, code?: string): Error {
  return new Error(code && bridgeCodes.has(code) ? `[RainSoul:${code}] ${message}` : message);
}
export function restoreOperationError(reason: unknown): unknown {
  if (!(reason instanceof Error)) return reason;
  const match = /^\[RainSoul:([A-Z_]+)\] ([\s\S]*)$/.exec(reason.message);
  return match && bridgeCodes.has(match[1]) ? operationError(match[2], match[1]) : reason;
}

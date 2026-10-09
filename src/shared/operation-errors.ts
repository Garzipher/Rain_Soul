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

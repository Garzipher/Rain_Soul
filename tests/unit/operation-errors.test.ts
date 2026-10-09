import { expect, it } from 'vitest';
import { isDefiniteRejection, operationError } from '../../src/shared/operation-errors';
it('仅明确拒绝允许重新生成，未知回执继续保留重试保护', () => {
  for (const code of ['REVISION_CONFLICT', 'INVALID_INPUT', 'NOT_FOUND']) {
    expect(isDefiniteRejection(operationError('未写入', code))).toBe(true);
  }
  expect(isDefiniteRejection(new Error('回执丢失'))).toBe(false);
  expect(isDefiniteRejection(operationError('存储失败', 'SQLITE_FULL'))).toBe(false);
});

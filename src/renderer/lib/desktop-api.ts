import type { DesktopApi } from '../../shared/contracts';
import { restoreOperationError } from '../../shared/operation-errors';

/** 在页面边界还原业务码；通信中断仍保持未知，不能伪装成确定失败。 */
export function restoreDesktopApi(api: DesktopApi): DesktopApi {
  const methods = new Map<PropertyKey, unknown>();
  // contextBridge 对象可能被冻结；复制属性，避免 Proxy 覆盖不可配置的方法。
  return new Proxy({ ...api }, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || property === 'onCloseRequested' || property === 'onCloseFailed') return value;
      if (!methods.has(property)) methods.set(property, (...args: unknown[]) => {
        try {
          return Promise.resolve(Reflect.apply(value, target, args)).catch((reason: unknown) => { throw restoreOperationError(reason); });
        } catch (reason) { throw restoreOperationError(reason); }
      });
      return methods.get(property);
    },
  });
}

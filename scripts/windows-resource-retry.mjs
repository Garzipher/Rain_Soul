import { retryWindowsFileOperation } from './windows-file-retry.mjs';

/** 包裹已锁定版本工具的完整资源编辑；不修改vendor、不省略图标/版本/执行级别。 */
export function installWindowsResourceRetry(editor, options) {
  const original = editor.editWindowsResources;
  if (typeof original !== 'function') throw new Error('打包工具资源编辑接口已变化，停止打包。');
  editor.editWindowsResources = function (...args) {
    return retryWindowsFileOperation(() => original.apply(this, args), options);
  };
}

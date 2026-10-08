import { createRequire } from 'node:module';
import { retryWindowsFileOperation } from './windows-file-retry.mjs';

const require = createRequire(import.meta.url);
const expectedVersion = '26.15.3';
for (const dependency of ['electron-builder', 'app-builder-lib']) {
  if (require(`${dependency}/package.json`).version !== expectedVersion) throw new Error(`打包适配仅验证过 ${dependency} ${expectedVersion}，升级前需要重新验证。`);
}
const electronWin = require('app-builder-lib/out/electron/electronWin');
const addIntegrity = electronWin.addWinAsarIntegrity;
if (typeof addIntegrity !== 'function') throw new Error('打包工具完整性接口已变化，停止打包以避免缺少校验。');

// 始终执行工具的完整资源写入，失败时只重试原函数，不跳过 ASAR 完整性。
electronWin.addWinAsarIntegrity = (...args) => retryWindowsFileOperation(() => addIntegrity(...args));
const { build, Platform, Arch } = require('electron-builder');
await build({ targets: Platform.WINDOWS.createTarget('dir', Arch.x64), config: { electronDist: 'node_modules/electron/dist' }, publish: 'never' });

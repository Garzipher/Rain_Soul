import { createRequire } from 'node:module';
import { join } from 'node:path';
import { env, argv, stdout } from 'node:process';
import { retryWindowsFileOperation } from './windows-file-retry.mjs';
import { fileURLToPath, URL } from 'node:url';
import { createModelPackConfiguration } from './model-pack-policy.mjs';
import { auditedDesktopBuild } from './audited-desktop-build.mjs';

const packing = await createModelPackConfiguration({ projectDirectory: fileURLToPath(new URL('../', import.meta.url)), args: argv.slice(2), outputDirectory: env.RAINSOUL_PACK_DIRECTORY });
stdout.write(packing.message + '\n');

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
// 可指定新产物目录，避免覆盖作者正在运行的旧版程序。
const target = argv.includes('--installer') ? 'nsis' : 'dir';
await auditedDesktopBuild(() => build({ targets: Platform.WINDOWS.createTarget(target, Arch.x64), config: {
  electronDist: 'node_modules/electron/dist', ...packing.config,
}, publish: 'never' }), () => packing.config.afterPack({ appOutDir: join(packing.config.directories.output, 'win-unpacked') }));

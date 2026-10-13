import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { assertSafeLocalPath, bundledManifest } from './prepare-bundled-retrieval-model.mjs';
import { checkBundledModelPackage } from './check-bundled-model-package.mjs';
import { auditDesktopPackage, checkDesktopBuild } from './desktop-package-audit.mjs';

function contains(parent, child) { const path = relative(parent, child); return path === '' || (!path.startsWith('..') && !isAbsolute(path)); }
async function exists(path) { return !!await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); }
/** 同目录临时文件完成写入后再替换；失败保留旧审计，未知文件不能覆盖。 */
async function writeAuditReport(report, data) {
  assertSafeLocalPath(report);
  const previous = await lstat(report).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (previous) {
    if (!previous.isFile() || previous.size > 16 * 1024 * 1024) throw new Error('已有审计记录目标无效，原内容已保留。');
    let saved; try { saved = JSON.parse(await readFile(report, 'utf8')); } catch { throw new Error('已有文件不是审计记录，原内容已保留。'); }
    if (saved?.schemaVersion !== 1 || !['research-without-model', 'formal-bundled'].includes(saved.mode) || !['asarSha256', 'membersSha256', 'buildMembersSha256'].every(key => typeof saved[key] === 'string' && /^[a-f0-9]{64}$/.test(saved[key])) || !Array.isArray(saved.files) || !Array.isArray(saved.resourceFiles)) throw new Error('已有文件不是审计记录，原内容已保留。');
  }
  const temporary = `${report}.${randomUUID()}.tmp`; assertSafeLocalPath(temporary);
  let handle, created = false;
  try {
    handle = await open(temporary, 'wx'); created = true;
    await handle.writeFile(JSON.stringify(data, null, 2), 'utf8'); await handle.sync(); await handle.close(); handle = null;
    assertSafeLocalPath(report); await rename(temporary, report);
  } finally {
    try { await handle?.close(); }
    finally { if (created) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  }
}
/** 正式路径只使用仓库默认可信锚；CLI和环境变量没有来源放行接口。 */
export async function createModelPackConfiguration({ projectDirectory, args = [], outputDirectory }) {
  if (args.some(arg => !['--installer', '--without-bundled-model'].includes(arg)) || new Set(args).size !== args.length) throw new Error('打包参数无效。');
  const root = resolve(projectDirectory), input = join(root, 'dist'), formal = join(root, 'release', 'current');
  const research = args.includes('--without-bundled-model');
  const output = outputDirectory ? resolve(root, outputDirectory) : research ? join(root, 'release', 'research-without-model', randomUUID()) : formal;
  assertSafeLocalPath(output);
  if (contains(output, input) || contains(input, output)) throw new Error('打包输出不能覆盖构建输入。');
  if (research && (contains(output, formal) || contains(formal, output) || await exists(output))) throw new Error('无模型研究包必须使用新的独立目录，不得覆盖正式包或已有产物。');
  if (!research) await checkBundledModelPackage(input);
  const buildMembers = await checkDesktopBuild(input);
  const extraResources = [{ from: join(input, 'desktop', 'THIRD_PARTY_NOTICES.txt'), to: 'THIRD_PARTY_NOTICES.txt' }];
  if (!research) extraResources.push({ from: join(input, 'retrieval-model', bundledManifest.revision), to: `retrieval-model/${bundledManifest.revision}` });
  return {
    mode: research ? 'research-without-model' : 'formal-bundled',
    message: research ? `研究包：本构建未捆绑模型，语义检索保持资格门禁；输出 ${output}` : `正式包：复制经仓库可信锚核验的模型；输出 ${output}`,
    config: {
      // 本项目尚未提供自动更新；禁止根据仓库地址推断更新服务。
      publish: null,
      nsis: { perMachine: false, packElevateHelper: false, allowElevation: false },
      directories: { output },
      beforePack: async () => {
        if (!research) await checkBundledModelPackage(input);
        if ((await checkDesktopBuild(input)).membersSha256 !== buildMembers.membersSha256) throw new Error('打包输入在配置后发生变化。');
      },
      files: ['dist/desktop/**/*', 'dist/renderer/**/*', 'package.json'],
      extraResources,
      afterPack: async context => {
        if ((await checkDesktopBuild(input)).membersSha256 !== buildMembers.membersSha256) throw new Error('打包输入在构建期间发生变化。');
        const resources = join(context.appOutDir, 'resources');
        if (research) {
          const model = join(resources, 'retrieval-model'); assertSafeLocalPath(model);
          if (await exists(model)) throw new Error('未捆绑研究包存在残留模型资源，停止打包。');
        } else {
          // 复制前再次核对父树，准备失败标记不能在builder启动后被忽略。
          await checkBundledModelPackage(input);
          await checkBundledModelPackage(resources);
        }
        const audit = await auditDesktopPackage(resources, buildMembers, { vendorDefaultAsar: join(root, 'node_modules', 'electron', 'dist', 'resources', 'default_app.asar'), allowModel: !research });
        const acceptance = join(output, 'acceptance'); assertSafeLocalPath(acceptance); await mkdir(acceptance, { recursive: true });
        const report = join(acceptance, 'desktop-package-audit.json'); assertSafeLocalPath(report);
        await writeAuditReport(report, { ...audit, mode: research ? 'research-without-model' : 'formal-bundled' });
      },
    },
  };
}

import { randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { assertSafeLocalPath, bundledManifest } from './prepare-bundled-retrieval-model.mjs';
import { checkBundledModelPackage } from './check-bundled-model-package.mjs';

function contains(parent, child) { const path = relative(parent, child); return path === '' || (!path.startsWith('..') && !isAbsolute(path)); }
async function exists(path) { return !!await lstat(path).catch(error => { if (error.code === 'ENOENT') return null; throw error; }); }
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
  const extraResources = [{ from: join(input, 'desktop', 'THIRD_PARTY_NOTICES.txt'), to: 'THIRD_PARTY_NOTICES.txt' }];
  if (!research) extraResources.push({ from: join(input, 'retrieval-model', bundledManifest.revision), to: `retrieval-model/${bundledManifest.revision}` });
  return {
    mode: research ? 'research-without-model' : 'formal-bundled',
    message: research ? `研究包：本构建未捆绑模型，语义检索保持资格门禁；输出 ${output}` : `正式包：复制经仓库可信锚核验的模型；输出 ${output}`,
    config: {
      directories: { output },
      files: ['dist/**/*', '!dist/retrieval-model', '!dist/retrieval-model/**/*', 'package.json'],
      extraResources,
      afterPack: async context => {
        const resources = join(context.appOutDir, 'resources');
        if (research) {
          const model = join(resources, 'retrieval-model'); assertSafeLocalPath(model);
          if (await exists(model)) throw new Error('未捆绑研究包存在残留模型资源，停止打包。');
        } else {
          // 复制前再次核对父树，准备失败标记不能在builder启动后被忽略。
          await checkBundledModelPackage(input);
          await checkBundledModelPackage(resources);
        }
      },
    },
  };
}

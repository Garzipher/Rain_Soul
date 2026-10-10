import { build } from 'esbuild';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { cwd } from 'node:process';
import { compileLearningCourse } from './build-learning-course.mjs';
import { collectThirdPartyNotices } from './third-party-notices.mjs';

await build({
  entryPoints: { main: 'src/main/index.ts', preload: 'src/preload/index.ts', 'database-worker': 'src/workers/database/worker.ts', 'web-article-worker': 'src/main/web-article-worker.ts', 'retrieval-runtime': 'src/workers/retrieval/runtime.ts', 'retrieval-worker': 'src/workers/retrieval/worker.ts' },
  outdir: 'dist/desktop', outExtension: { '.js': '.cjs' },
  bundle: true, platform: 'node', target: 'node24', format: 'cjs',
  external: ['electron', 'better-sqlite3', 'onnxruntime-web/wasm'], sourcemap: false,
  plugins: [{ name: '固定纯WASM后端', setup(builder) {
    builder.onResolve({ filter: /^onnxruntime-web\/wasm$/ }, () => ({ path: './retrieval-ort-wasm.cjs', external: true }));
  } }],
});
await copyFile('node_modules/onnxruntime-web/dist/ort.wasm.min.js', 'dist/desktop/retrieval-ort-wasm.cjs');
await mkdir('dist/desktop/retrieval-wasm', { recursive: true });
for (const file of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) await copyFile(`node_modules/onnxruntime-web/dist/${file}`, `dist/desktop/retrieval-wasm/${file}`);
await copyFile('assets/rainsoul.png', 'dist/desktop/rainsoul.png');
await writeFile('dist/desktop/learning-course.json', JSON.stringify(compileLearningCourse('learning/项目全流程开发学习')));
await writeFile('dist/desktop/THIRD_PARTY_NOTICES.txt', collectThirdPartyNotices(cwd(), { bundledDependencies: ['@huggingface/tokenizers', 'onnxruntime-web', 'onnxruntime-common'] }));

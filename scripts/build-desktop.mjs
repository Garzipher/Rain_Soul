import { build } from 'esbuild';
import { copyFile, writeFile } from 'node:fs/promises';
import { compileLearningCourse } from './build-learning-course.mjs';

await build({
  entryPoints: { main: 'src/main/index.ts', preload: 'src/preload/index.ts', 'database-worker': 'src/workers/database/worker.ts' },
  outdir: 'dist/desktop', outExtension: { '.js': '.cjs' },
  bundle: true, platform: 'node', target: 'node24', format: 'cjs',
  external: ['electron', 'better-sqlite3'], sourcemap: false,
});
await copyFile('assets/rainsoul.png', 'dist/desktop/rainsoul.png');
await writeFile('dist/desktop/learning-course.json', JSON.stringify(compileLearningCourse('learning/项目全流程开发学习')));

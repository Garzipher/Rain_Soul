import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { setTimeout, clearTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';

/** 单独测试构建，不写入生产dist或放行资格。 */
export async function qualifyRestrictedRender(reportPath) {
  const directory = await mkdtemp(join(tmpdir(), 'rainsoul-render-qualification-'));
  const entry = fileURLToPath(new URL('../tests/fixtures/restricted-render/harness.ts', import.meta.url)), bundle = join(directory, 'harness.cjs'), resultPath = join(directory, 'report.json');
  const electronPath = createRequire(import.meta.url)('electron');
  try {
    await build({ entryPoints: [entry], outfile: bundle, platform: 'node', format: 'cjs', bundle: true, external: ['electron'], target: 'node22' });
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    let log = '';
    const child = spawn(electronPath, [bundle, resultPath, '--user-data-dir=' + join(directory, 'profile')], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const capture = bytes => { if (log.length < 20000) log += bytes.toString().slice(0, 20000 - log.length); };
    child.stdout.on('data', capture); child.stderr.on('data', capture);
    await new Promise((resolveRun, reject) => {
      const timer = setTimeout(() => {
        // Windows须清掉本次独立测试的子进程树，避免挂起renderer污染下一轮观测。
        if (process.platform === 'win32' && child.pid) {
          const termination = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          termination.once('error', reject);termination.once('exit', () => reject(new Error('实际Electron夹具超过180秒，结果不能放行。')));
        } else { child.kill();reject(new Error('实际Electron夹具超过180秒，结果不能放行。')); }
      }, 180000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); if (code === 0) resolveRun(); else reject(new Error(`Electron夹具退出码${code}\n${log}`)); });
    });
    const report = JSON.parse(await readFile(resultPath, 'utf8'));
    report.executableSha256 = createHash('sha256').update(await readFile(electronPath)).digest('hex');
    report.harnessSha256 = createHash('sha256').update(await readFile(bundle)).digest('hex');
    report.executablePath = electronPath;
    report.evidenceScope = '独立Electron运行时与受控目标监听；未验收正式安装包或全系统网络。';
    report.diagnostics = log;
    await mkdir(dirname(reportPath), { recursive: true }); await writeFile(reportPath, JSON.stringify(report, null, 2));
    return report;
  } finally { await rm(directory, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const reportPath = process.argv[2]; if (!reportPath || !isAbsolute(reportPath) || process.argv.length !== 3) throw new Error('用法：node scripts/qualify-restricted-render.mjs <绝对报告路径>');
    const report = await qualifyRestrictedRender(reportPath);
    process.stdout.write(JSON.stringify({ reportPath, qualification: report.qualification, results: report.results.map(({ name, status, error }) => ({ name, status, error })) }) + '\n');
    if (report.qualification.runtimeFixtures !== 'passed') process.exitCode = 1;
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

import { readFile } from 'node:fs/promises';
import { pathToFileURL, URL } from 'node:url';
import { isIP } from 'node:net';
import process from 'node:process';

export const windowsCases = ['fresh-install', 'upgrade', 'uninstall-keep', 'uninstall-cancel', 'uninstall-delete', 'uninstall-running-refusal', 'uninstall-silent-keep'];
export const cloudOperations = ['sentencePolish', 'paragraphPolish', 'continue', 'correct', 'consistency', 'plotFeel', 'extractKnowledge'];
const supportedOs = ['Windows 10', 'Windows 11'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && !!value.trim();
const sha = value => typeof value === 'string' && /^[a-f\d]{64}$/i.test(value);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function cloudUrl(value) {
  try {
    const url = new URL(value), host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return false;
    if (host === 'localhost' || ['.test', '.invalid', '.local', '.internal', '.localhost'].some(suffix => host.endsWith(suffix))) return false;
    if (isIP(host) === 4) {
      const [a, b, c] = host.split('.').map(Number);
      return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
        a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) || a === 100 && b >= 64 && b <= 127 ||
        a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
    }
    if (isIP(host) === 6) return /^[23][a-f\d]{3}:/i.test(host) && !/^2001:(?:db8|0):/i.test(host);
    return host.includes('.');
  }
  catch { return false; }
}

/** 只检查声明字段是否完整一致，不能证明材料真实性，也不执行安装或网络请求。 */
export function validateReleaseEvidence(input) {
  const issues = [], evidence = object(input) ? input : {};
  const require = (condition, path, message) => { if (!condition) issues.push({ path, message }); };
  require(nonempty(evidence.version), 'version', '缺少本次正式包版本。');
  require(sha(evidence.installerSha256), 'installerSha256', '缺少正式安装器 SHA-256。');
  function common(row, path) {
    require(row.result === 'passed', `${path}.result`, '实际测试未通过或尚未执行。');
    require(row.version === evidence.version, `${path}.version`, '测试版本与正式包版本不一致。');
    require(validDate(row.date), `${path}.date`, '缺少有效的实际执行日期（YYYY-MM-DD）。');
    require(object(row.artifacts) && Array.isArray(row.artifacts.screenshot) && row.artifacts.screenshot.length > 0 && row.artifacts.screenshot.every(nonempty), `${path}.artifacts.screenshot`, '缺少实际截图文件索引。');
    require(object(row.artifacts) && nonempty(row.artifacts.journal), `${path}.artifacts.journal`, '缺少实际执行日志文件索引。');
  }
  const windows = Array.isArray(evidence.windows) ? evidence.windows : [], seen = new Set();
  for (const [index, value] of windows.entries()) {
    const path = `windows[${index}]`, row = object(value) ? value : {};
    const supported = supportedOs.includes(row.os) && windowsCases.includes(row.case);
    require(supported, path, '不支持的系统或矩阵场景。');
    const identity = `${row.os}/${row.case}`;
    require(!seen.has(identity), path, '矩阵场景重复，不能替代未执行项。'); seen.add(identity);
    common(row, path);
    require(nonempty(row.osBuild), `${path}.osBuild`, '缺少实际 Windows 构建号。');
    require(row.standardUser === true, `${path}.standardUser`, '必须使用标准用户实际验收。');
    require(['vm', 'dedicated-machine'].includes(row.isolation), `${path}.isolation`, '需要隔离虚拟机或专用测试机；同账户换目录不能隔离注册键。');
    require(sha(row.installerSha256) && row.installerSha256.toLowerCase() === String(evidence.installerSha256).toLowerCase(), `${path}.installerSha256`, '实际安装器哈希不匹配。');
    const outcome = row.case === 'uninstall-cancel' ? 'cancelled' : row.case === 'uninstall-running-refusal' ? 'refused' : 'completed';
    require(row.expectedOutcome === outcome, `${path}.expectedOutcome`, '实际场景预期行为声明不匹配。');
    require(Number.isInteger(row.exitCode) && Number.isInteger(row.expectedExitCode) && row.exitCode === row.expectedExitCode && (outcome !== 'completed' || row.exitCode === 0), `${path}.exitCode`, '退出码缺失或与实际场景预期不匹配。');
    require(row.assetsVerified === true, `${path}.assetsVerified`, '未验证安装状态和作者资产。');
    for (const check of ['programState', 'authorDataState', 'externalBackupUnchanged']) require(object(row.checks) && row.checks[check] === true, `${path}.checks.${check}`, '程序、作者数据和外部备份须逐项符合场景预期。');
    if (row.case === 'upgrade') {
      require(nonempty(row.oldVersion) && row.oldVersion !== evidence.version, `${path}.oldVersion`, '升级需要真实旧版本。');
      require(sha(row.oldInstallerSha256) && row.oldInstallerSha256.toLowerCase() !== String(evidence.installerSha256).toLowerCase(), `${path}.oldInstallerSha256`, '升级需要真实旧安装器哈希。');
    }
  }
  for (const os of supportedOs) for (const testCase of windowsCases) require(seen.has(`${os}/${testCase}`), `windows.${os}.${testCase}`, '缺少实际系统矩阵验收。');
  const cloud = Array.isArray(evidence.cloud) ? evidence.cloud : [], cloudSeen = new Set();
  for (const [index, value] of cloud.entries()) {
    const path = `cloud[${index}]`, row = object(value) ? value : {};
    require(cloudOperations.includes(row.operation), `${path}.operation`, '不支持的云操作。');
    require(!cloudSeen.has(row.operation), `${path}.operation`, '云操作证据重复。'); cloudSeen.add(row.operation);
    common(row, path);
    require(nonempty(row.service), `${path}.service`, '缺少实际服务名。');
    require(cloudUrl(row.serviceUrl), `${path}.serviceUrl`, '真实云服务必须记录 HTTPS 地址，不能使用本地测试服务。');
    require(nonempty(row.model), `${path}.model`, '缺少实际模型名。');
    for (const check of ['realService', 'syntheticOnly', 'authorized', 'noCredentialsInArtifacts', 'noAutoRetry', 'responseCompatibility']) require(row[check] === true, `${path}.${check}`, '真实调用、合成材料、授权、凭据脱敏、响应兼容和禁止自动重发必须实证通过。');
    require(sha(row.requestHash), `${path}.requestHash`, '缺少实际授权请求哈希。');
    for (const field of ['billingEvidence', 'billingDescription', 'authorizationEvidence', 'responseEvidence', 'noAutoRetryEvidence']) require(nonempty(row[field]), `${path}.${field}`, '缺少实际费用/授权/响应/网络次数证据。');
  }
  for (const operation of cloudOperations) require(cloudSeen.has(operation), `cloud.${operation}`, '缺少真实云操作验收。');
  return { status: issues.length ? 'blocked' : 'evidence-complete', schemaOnly: true, issues,
    warning: '本工具仅校验声明结构，不能证明证据真实性、文件存在或真实操作成功；仍须人工核对截图、日志与测试机，不能单独据此宣布 P0 发布。' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 3) throw new Error('用法：node scripts/release-gate.mjs <实际证据.json>');
    // Windows PowerShell 5 的 UTF-8 文件可能含 BOM；仅移除文件开头标记。
    const report = validateReleaseEvidence(JSON.parse((await readFile(process.argv[2], 'utf-8')).replace(/^\ufeff/, '')));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === 'blocked' ? 2 : 0;
  } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : '证据读取失败'}\n`); process.exitCode = 1; }
}

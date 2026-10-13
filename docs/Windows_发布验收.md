# Windows 与真实云服务发布验收

本文件提供实际操作步骤。`scripts/release-gate.mjs` 只校验证据声明是否完整一致，不安装、不卸载、不调用云服务；即使输出 `evidence-complete`，也必须人工核对材料和实际测试机。测试桩、开发入口和同一账户换安装目录，不能代替干净系统验收。

## 测试环境与材料

2026-10-12 环境核对：当前没有已配置的独立虚拟机，Windows 10/11 的十四格继续 `pending`，按作者要求暂缓执行。可使用无作者数据的专用物理测试机完成同一矩阵；同机新账号或另换安装目录不能证明干净系统兼容性。Windows Sandbox 适合临时全新安装检查，不能独自代替需要保留旧版本与数据的升级矩阵。本轮不修改宿主虚拟化配置，不在日常作者账户执行卸载实验。

准备 Windows 10 64 位、Windows 11 64 位的独立虚拟机或专用测试机，并创建标准用户。每个场景恢复基准快照，从明确的初始状态开始；记录系统版本、构建号、执行日期、安装器版本与 SHA-256。测试账号不能包含作者真实作品或共享的工作目录。

NSIS 使用固定安装注册键。同账户即使换目录，仍可能升级或卸载已有 RainSoul。不要在日常作者账户运行删除数据场景，也不要手工删除注册键来冒充干净系统。干净基准应没有 RainSoul 安装项及应用数据；升级场景则应从可信旧版安装器建立。

测试作品使用合成正文，包含卷章、知识标签/分类、引用与伏笔、大纲、写作特点、版本快照、图文教材；如本次包包含需求会话，还要包含会话、消息与草稿。把 `.rainsoul` 备份及 DOCX/TXT 导出放到应用数据目录之外，计算哈希。记录卸载前后的作品内容与资产完整性，截图不出现真实 API Key。

```powershell
Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, OsBuildNumber
Get-FileHash -LiteralPath 'C:\验收\RainSoul Setup 当前版本.exe' -Algorithm SHA256

# 只读检查当前用户安装登记；实际路径以登记项为准。
Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' |
  Where-Object { $_.DisplayName -eq 'RainSoul' } |
  Select-Object DisplayName, DisplayVersion, InstallLocation, UninstallString
```

先确认已进入隔离标准用户，再从图形界面启动安装器。要记录进程退出码，可使用下列方式；路径必须是本次已核验的安装器。

```powershell
$installerProcess = Start-Process -FilePath 'C:\验收\RainSoul Setup 当前版本.exe' -PassThru -Wait
$installerProcess.ExitCode
```

完整进程退出码只是证据之一。卸载器取消可能也返回 0；因此必须同时记录实际 UI 行为、程序是否仍存在、数据是否符合预期。截图与操作日志缺一不可。

## Windows 验收矩阵

下列七项在两个系统分别运行，共十四格。每格记录 `result`、实际与预期退出码、截图索引和日志索引。失败或未运行保持 `failed` / `pending`，修复后重新运行对应场景，保留失败证据。

| case | 初始状态与操作 | 必须核对的程序与数据结果 |
| --- | --- | --- |
| `fresh-install` | 从无安装、无数据的系统快照安装当前包；标准用户直接启动 | 正常安装和启动、设置版本匹配、离线写作/保存/搜索/导出可用；默认学习作品存在且图文可读；无管理员依赖 |
| `upgrade` | 安装可信旧版本，创建合成资产并退出；运行当前安装器原位升级 | 版本升级成功；原作品和全部资产可读取；迁移不丢失数据，目录外备份不变；记录旧版本及旧安装器哈希 |
| `uninstall-keep` | 当前包已安装，有合成资产；交互卸载时选择“否” | 程序卸载，应用数据保留；重新安装后作品与资产完整；外部备份哈希不变 |
| `uninstall-cancel` | 同上，卸载数据选择对话框选择“取消” | 卸载中止，程序仍可启动，全部数据完整；`expectedOutcome=cancelled`，退出码匹配事先记录的预期 |
| `uninstall-delete` | 同上，程序已退出；两次明确确认删除数据 | 程序和当前测试用户应用数据删除；外部备份不变；重新安装没有原合成作品及云凭据，默认教材重新初始化 |
| `uninstall-running-refusal` | 当前程序保持运行；交互卸载时确认删除 | 数据清理被拒绝，卸载中止，程序和数据仍完整；记录拒绝提示、卸载器及清理子进程退出码；`expectedOutcome=refused` |
| `uninstall-silent-keep` | 当前包已安装且退出；运行实际登记的卸载器并加 `/S` | 静默卸载程序，默认保留作品数据；重装可读取，外部备份不变；不允许静默删除数据 |

卸载步骤使用系统“应用和功能”或登记项指向的真实卸载器。静默测试先确认标准用户和隔离环境，使用真实路径；不要复制日常机器路径。

每格 `checks.programState`、`checks.authorDataState`、`checks.externalBackupUnchanged` 的 `true` 表示“符合这一场景预期”，不是所有场景都要求程序/数据存在。`assetsVerified=true` 只能在上述资产逐项核对后填写。成功完成场景须退出码 0；取消及运行拒绝允许实际非零，但必须与预期相符且行为、数据均核验。

## 真实云操作验收

2026-10-13已在正式开发入口完成OpenRouter免费模型的真实会话、续写/知识参考及AI拆书，候选确认应用与建议审核入库成功。`openrouter/free`本轮返回与任务无关内容，最终固定 `dots-studio/dots-3-note-preview:free`；已观察会话超出所要求字数。完整结果见[真实云报告](../tasks/real-cloud-validation-2026-10-13.md)。这不等于下方七项P0与最终包验收通过；Windows十四格继续pending。

服务必须由测试人员在 RainSoul 设置中配置，API Key 存入系统安全存储，不写聊天、JSON、截图、日志、归档或错误报告。本地伪服务可以验证异常流程，但不算本节真实服务通过。

每次请求在程序中预览实际服务、模型、发送范围、费用或计费提示，确认只含合成测试文本后授权。保存脱敏后的请求哈希、授权截图、模型响应格式、费用/额度记录和网络请求次数；不能把仅 HTTP 200 当成功。七项操作都要实际完成：

| operation | 操作与判定 |
| --- | --- |
| `sentencePolish` | 精确选择一句润色；候选可对比，确认前正文不变；只替换该句 |
| `paragraphPolish` | 段落润色；保留书签，候选审核后写入，并生成保护快照 |
| `continue` | 在目标段后续写；原文和书签保留，候选不自动写入 |
| `correct` | 合成错字纠错；作者确认候选，保存后能重开 |
| `consistency` | 角色/时间/地点等矛盾材料；结果为有证据及不确定性的建议，不自动改稿 |
| `plotFeel` | 与大纲不一致的合成片段；明确 AI 建议，显示依据，不自动改稿 |
| `extractKnowledge` | 提取候选；逐条审核后新建或更新知识，取消不写库，来源可追溯 |

同时检查取消授权没有云请求；超时、断网、额度不足或拒绝/截断响应保留原文及候选状态，不自动重发。实际供应商响应兼容必须观察；仅单元测试覆盖、服务介绍或模型可用列表不能替代调用。每项 `noAutoRetry=true` 需要网络次数/故障操作日志支持。

### P1真实云附加验收

需求会话与AI辅助拆书分别追加真实云证据，不用P0七项结果或本地网络替身替代。会话验证逐次授权、完整回复持久化、未知回执只核对/保存不重发，以及取消和费用。AI拆书使用合成TXT/DOCX原段，确认只发送选中原段和分类标签字典；记录合法摘录核对、写法/场景/练习质量、无建议结果、模型容量、坏格式及取消行为。建议默认不入库，带入与替换前再核对版本和配置，确认审核后检查真实出处及重启持久化。

两项均记录正式包版本/哈希、服务/实际模型、授权范围/requestHash、脱敏响应、费用/额度与网络次数。无凭据或环境缺失保持pending。当前`release-gate.mjs`自动检查仅覆盖14个Windows场景及7个P0云操作，P1附加验收需人工逐项核对独立记录，不能以该工具结构通过宣称P1真实云已验。

### 免费服务的实际边界

历史记录（2026-10-12）公共模型目录复核：OpenRouter 列出了十五个 `:free` 且输入/输出标价为零的模型；本轮只读取公开目录，没有发送生成请求。受控联调服务优先选 OpenRouter，基础地址 `https://openrouter.ai/api/v1`。免费目录不证明中文写作质量、持续可用性或账户额度；联调时固定当日模型并记录实际响应模型。当时无作者专用 API Key，均保持 `pending`；2026-10-13部分开发入口结果见上文，最终包及全项矩阵仍待验。

API Key 需要作者本人注册后创建，在程序设置中安全保存。DeepSeek、豆包可以通过各自官方 API 接入，免费试用与计费按账户及官方当日政策核实：[DeepSeek](https://api-docs.deepseek.com/quick_start/pricing)、[豆包/火山引擎](https://www.volcengine.com/docs/82379/1099320)。网页聊天界面不是本项目支持的 API，不能以模拟登录、抓取内部接口或复用浏览器凭据替代官方接入。作者可手工在网页聊天后粘贴结果，但这不能算程序云接口验收。

2026-10-09 读取的 OpenRouter 官方 [FAQ](https://openrouter.ai/docs/faq) 与 [额度限制](https://openrouter.ai/docs/api/reference/limits) 说明存在 `:free` 模型及 `openrouter/free` 免费路由。访问 API 仍需注册账户并创建 API Key；免费不等于无身份凭据。

官方文档当日给出的免费模型限制为每分钟 20 次；累计购买不足 10 USD 时每日通常 50 次，达到额度条件后通常 1000 次。模型和限额可能变化，开始验收前重新查官方页面。官方也说明免费模型通常不适合生产。使用免费路由还需记录响应中的实际模型，不能把路由别名当确定供应商模型。

可在设置填写 OpenRouter API 基础地址 `https://openrouter.ai/api/v1`，选择当时可用免费模型，并设置计费提示；凭据必须由账户持有人提供。没有凭据、免费模型不可用或额度不足时，本项保持未验收；不要借用其他工具的凭据，也不擅自购买额度。可读 Markdown 官方来源：[FAQ 源文](https://openrouter.ai/docs/faq.md)、[限制源文](https://openrouter.ai/docs/api/reference/limits.md)。

## 证据 JSON 与只读校验

下面仅生成全部 `pending` 的空模板，不执行安装/卸载/云调用，不提供默认通过证据。手动补齐真实结果及材料后再运行校验。版本和哈希必须替换为本轮正式包，材料路径可记录相对证据目录的文件名。请用 Node.js 运行工具。

```powershell
$evidenceDirectory = 'E:\soulrain\test-results-release'
$evidenceFile = Join-Path $evidenceDirectory 'evidence.pending.json'
if (Test-Path -LiteralPath $evidenceFile) { throw '模板已存在，避免覆盖真实证据。' }
New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
$caseNames = @('fresh-install', 'upgrade', 'uninstall-keep', 'uninstall-cancel', 'uninstall-delete', 'uninstall-running-refusal', 'uninstall-silent-keep')
$windowsRows = foreach ($osName in @('Windows 10', 'Windows 11')) {
  foreach ($caseName in $caseNames) {
    $row = [ordered]@{
      os=$osName; case=$caseName; osBuild=''; standardUser=$false; isolation='';
      version=''; installerSha256=''; date=''; result='pending';
      expectedOutcome=''; exitCode=$null; expectedExitCode=$null; assetsVerified=$false;
      checks=@{programState=$false; authorDataState=$false; externalBackupUnchanged=$false};
      artifacts=@{screenshot=@(); journal=''}
    }
    if ($caseName -eq 'upgrade') { $row.oldVersion=''; $row.oldInstallerSha256='' }
    $row
  }
}
$cloudRows = foreach ($operationName in @('sentencePolish', 'paragraphPolish', 'continue', 'correct', 'consistency', 'plotFeel', 'extractKnowledge')) {
  [ordered]@{
    operation=$operationName; version=''; result='pending'; date='';
    realService=$false; service=''; serviceUrl=''; model=''; syntheticOnly=$false; authorized=$false;
    noCredentialsInArtifacts=$false; noAutoRetry=$false; responseCompatibility=$false; requestHash='';
    billingEvidence=''; billingDescription=''; authorizationEvidence=''; responseEvidence=''; noAutoRetryEvidence='';
    artifacts=@{screenshot=@(); journal=''}
  }
}
@{version=''; installerSha256=''; windows=@($windowsRows); cloud=@($cloudRows)} |
  ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $evidenceFile -Encoding UTF8

node E:\soulrain\scripts\release-gate.mjs $evidenceFile
# 空模板输出 blocked，退出码 2；这是预期结果。
```

校验工具退出码：`0` 表示声明结构齐全；`2` 表示缺项、失败或内容不一致；`1` 表示 JSON/文件/用法错误。工具兼容 Windows PowerShell 5 写出的 UTF-8 BOM。

人工复审逐个打开所列截图、日志与账单/额度记录，核对没有 Key/真实作者正文，确认日期、版本和安装器哈希对应本次测试。结构齐全不是真实性证明，也不替代源码测试、覆盖率、静态检查、生产构建、实际包测试及独立代码审查。任何实际失败、环境缺失或未授权云调用都不能宣布 P0 最终发布门禁完成。

# P0 AI 候选与知识回写补全

日期：2026-10-09。开发基线：`5c37958`，沿用现行立项 V2.0、PRD、技术方案与 Demo。

## 本轮范围

- [x] 完整响应保护：截断、过滤、工具调用、拒绝与未知结束状态不能生成可应用候选；缺失结束字段的兼容服务仍可使用。
- [x] 写作特点草稿保护：未发布草稿期间锁定章节覆盖，发布与放弃仍可用。
- [x] 知识来源：通过实际上下文构建链路记录全部授权章节、段落、版本、摘录及哈希；明确是获准读取的上下文，不伪称逐条引用证据。
- [x] 知识更新：默认新建；显式选择当前作品有效条目，对比旧内容，变更后重新审核；稳定 ID 更新、保护快照、历史与索引在单一事务内完成。
- [x] 来源投影：审计资料退出普通出处、全文索引与后续AI参考；原始记录保留，旧索引幂等修复。
- [x] 教材：先讲完成状态、材料来源与更新事务原理，再讲源码、跟做和练习；补实际窗口截图。
- [x] 正式验证：review、完整 verify、生产构建、真实 Electron、重新打包与实际 EXE 验收。

## TDD 与分工

GSD Core 分配 AI 响应、草稿与跨章来源独立任务；root 实现知识更新协议、交互与事务，统一审查和验收。共享文件顺序交接，避免同时修改数据库模块。

- 响应 Red：11 项真实行为失败；Green：48 项全部通过。
- 草稿 Red：5 项覆盖锁定失败；Green：16 项全部通过。
- 来源 Red：7 项授权来源断言失败；Green：与上下文合计33项全部通过。
- 更新 UI Red：缺少入库方式选择；Green：17 项全部通过。
- 更新数据库 Red：更新请求被旧协议拒绝，3项失败、2项通过；Green：与来源合计31项通过。UI空标签序列化与发送按钮误用危险色各新增真实失败，修复后与协议/权限边界合计33项通过。
- 来源投影 Red：6类消费点、旧索引与剧情关联泄露审计材料；Green：8组51项通过。
- 独立review追踪更新全链路、完整响应与草稿、授权来源与投影均无未解决阻断项。真实Electron授权预览/取消及草稿保护用例通过，未向云服务发送请求。

## 产物与外部验收

核对时旧 `release/p0-20261009`、隔离目录与1.0.1安装器均已不存在。当前1.0.2需在新包验收后清理，不能清理作者项目数据。

真实云服务与账单、其他Word版本、干净Windows10/11安装升级卸载仍需对应外部环境。测试替身与本机目录包验收不替代这些结论。

## 验证过程与新增证据

- 首次完整verify类型/Lint通过，81组中80组、624项中623项通过；搜索跳转测试未找到正文结果，退出1，未作为交付证据。独立复跑搜索跳转通过，但多页面真实SQLite流程耗尽10秒总预算。补编辑器可输入与粘贴完成检查；仅该多步流程总预算调整为20秒，产品搜索P95门槛不变。专项2组9项通过，来源解析器行、语句、函数、分支均100%；纳入日常覆盖率门禁后再次全套验证。
- Microsoft Word 2007（应用版本12.0）实际打开当前源码导出函数生成的隔离样稿：8个段落、1页；中文正文、硬换行、知识引用、伏笔标记与两类清单均可读取，标题16磅；审计材料未进入手稿。Word生成PDF，经渲染检查无乱码或裁切。关闭自动化先释放文档导致RPC断连，调整为先Quit再释放对象后退出0。只操作新建的隔离文档与独立Word实例。
- Word证据为 `test-results-logs/2026-10-09/.p0-ai-word-final.log`、`test-results-word/RainSoul-Word验收.docx`、`test-results-word/RainSoul-Word验收.pdf`及`test-results-word/Word-渲染.png`；这是一个兼容性样稿，不冒充所有Word版本、长篇排版或干净系统矩阵。
- 第二次verify单元/组件624项、类型、Lint与生产构建通过，行96.72%、分支86.81%；真实桌面17项通过、1项右键AI入口失败，Demo阶段未执行，整体退出1。200样本搜索P95为177.50ms。读取轨迹及ProseMirror事件顺序后定位自定义右键先于内部选区同步；单独复跑内部选区已同步时通过，不将偶然重跑成功当作修复。
- 新增回归设置DOM选区而不派发selectionchange，正反选区两项真实失败；修复在正文边界内用公开posAtDOM映射当前位置，区外或无法映射保持原生菜单，不修改正文或扩大授权。与书签和选区合计13项通过，类型/Lint/构建通过并提交`efd6dac`；教材`17413ef`补原理与实验。最终交付以修复后的完整verify与实际包验收为准。
- 第三次verify在覆盖率组件阶段发现旧快照导出测试缓存了列表刷新前已断开的按钮，点击未触发导出；正文定位另触发jsdom缺少Range几何方法的未处理异常。626项通过、1项失败，整体退出1。测试改为点击时重新查找当前按钮，并按既有renderer-ai-protection模式局部补齐/恢复Range几何接口；覆盖率环境专项2组8项通过且无未处理异常。该诊断仅执行组件用例，不作为核心逻辑覆盖率成绩；正式全套门禁与原80%阈值保持不变。
- 第四次verify626项通过、1项失败：写作特点控件解锁后立即检查useEffect脏状态回调，尚收到true。保留false断言并改为waitFor等待异步通知，不改产品逻辑、阈值或其他断言；专项16项通过后再次完整验证。

## 最终交付门禁

- `npm run verify`最终退出0（`test-results-logs/2026-10-09/.p0-ai-final-acceptance.log`）：82组627项单元/组件、18项真实Electron、69项Demo全部通过；类型检查、ESLint及生产构建通过，无未处理异常。覆盖率行96.72%、语句91.27%、函数93.79%、分支86.81%，原80%阈值保持。真实窗口200样本搜索P95为206.50ms。
- 独立review最终无阻断；额外复审`efd6dac`选区边界与`17413ef`教材一致性、`f4300fc`局部jsdom适配和快照节点重查询，确认未扩大授权、未削弱业务断言。写作特点`fb212da`仅等待useEffect回调。
- 教材仍为八卷35章13张离线图片，生产构建校验通过；本轮来源、事务与快速右键推理已写入教材，Compound Engineering耐久性检查无需重复沉淀。Claude Mem本地DB不存在且无可调用接口，没有虚构记忆写入。
- `npm run pack:installer`首次在写入EXE资源时遇到`UNKNOWN/open`，未生成可交付包；完整重试后退出0（`test-results-logs/2026-10-09/.p0-ai-completion-pack-final.log`），未跳过资源或ASAR完整性写入。重复依赖引用为打包工具的依赖分析信息，32个构建文件已逐一与包内SHA-256匹配。
- 1.0.3安装器为`release/current/RainSoul Setup 1.0.3.exe`，129,662,582字节；SHA-256为`b21ea7bead589758ed37af6f36f32d98040151460f1bbc5d87323e432d77c6de`。核验6,537个包内文件，Electron/Chromium/第三方许可齐备，未混入作者数据库、项目归档、AI配置或个人资料（`test-results-logs/2026-10-09/.p0-ai-package-integrity.log`）。安装器与目录包EXE均为NotSigned。
- 设置`RAINSOUL_TEST_EXECUTABLE`指向`release/current/win-unpacked/RainSoul.exe`，使用隔离作者目录执行完整桌面验收；18项全部通过、退出0（`test-results-logs/2026-10-09/.p0-ai-completion-exe.log`），200样本搜索P95为149.30ms。验证的是实际打包EXE，没有使用开发入口替代，也没有执行NSIS安装矩阵或真实云请求。
- 最终文档按review清单复核版本、日志、安装器路径、清理边界与外部验收限制，未发现阻断项。代码和教材已分步提交本地main；本轮验收记录与三份开发基线统一提交，未推送远端。文档变更不新增测试，以既有完整门禁、实际包验收和`git diff --check`为验证依据。

## 手动清理旧产物

先保存作品、退出旧版程序。以下清单均为明确的旧产物路径，不包含本机作品数据；不存在时跳过。只有新版1.0.3验收完成后才清理1.0.2安装器。

```powershell
$oldArtifacts = @(
  'E:\soulrain\release\p0-20261009',
  'E:\soulrain\.legacy-artifacts-20261009',
  'E:\soulrain\release\current\RainSoul Setup 1.0.1.exe',
  'E:\soulrain\release\current\RainSoul Setup 1.0.1.exe.blockmap',
  'E:\soulrain\release\current\RainSoul Setup 1.0.2.exe',
  'E:\soulrain\release\current\RainSoul Setup 1.0.2.exe.blockmap'
)
foreach ($item in $oldArtifacts) {
  if (Test-Path -LiteralPath $item) {
    Remove-Item -LiteralPath $item -Recurse -Force -ErrorAction Stop
  }
}
```

若历史目录的ASAR仍被占用，可在保存作品后执行下列命令，再重试删除；只匹配历史目录中的RainSoul，不终止Codex或其他Electron程序。

```powershell
Get-Process RainSoul -ErrorAction SilentlyContinue |
  Where-Object { $_.Path -like 'E:\soulrain\release\p0-20261009\*' } |
  Stop-Process
```

本轮按用户要求提供手动命令，没有执行产物删除。

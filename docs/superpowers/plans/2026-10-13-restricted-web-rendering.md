# 一次性受限网页渲染实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本项目按 AGENTS.md 优先采用 GSD Core 调度，保留 TDD、独立审查和验证模块。

**Goal:** 在拆书工具中提供经实际包隔离验收的显式网页渲染，并保存可追溯来源。

**Architecture:** 复用 Electron；Node 校验和固定公网 IP 获取初始 HTML，同源 GET broker 提供资源，一次性 session 的独立 renderer 产生有界 DOM。来源捕获记录独立存储，旧快照先校验原哈希再内存兼容。未通过网络反例门禁时渲染入口禁用。

**Tech Stack:** Electron 44.7.0、Node HTTPS、React/TypeScript、SQLite、Readability worker、Vitest、Playwright。

**Spec:** [已确认规格](../specs/2026-10-12-restricted-web-rendering-design.md)。状态：用户已批准并授权实施；实现与独立审查完成，最新研究包回归通过、正式资格待验，逐项证据见 tasks/restricted-render-ledger.md。

**进度口径（2026-10-13）：** 勾选仅表示已有实现或对应证据；原始RED缺记录不从GREEN反推，专项不相加。最新研究安装器及实际EXE32桌面场景、74Demo、最终资源审计和小窗口检查通过，独立代码review完成；最终源码158文件/1477测试及核心覆盖率门禁通过，详见ledger。模型来源/五资格、系统网络、产品EXE实际动态渲染、真实云和干净Windows继续pending。

## Global Constraints

- 默认 static，只有显式确认才运行 restricted-browser；不自动重试或回退为直连。
- HTTPS/443、无网址凭据、公网域名、每跳 DNS 全结果验证并固定 IP；最多三次重定向，子资源固定最终 origin 且只接受 GET。
- 共享总期限 40 秒，初始最多 30 秒；最多 80 请求、4 并发。单响应压缩 2 MiB/展开 5 MiB，全任务压缩 12 MiB/展开 24 MiB，重定向正文也计入。
- DOM 节点与属性合计最多 20,000、序列化 UTF-8 最多 5 MiB；正文最多 200,000 Unicode 字符/2,000 非空段落。先有界遍历再序列化。
- 请求安静 500ms，最多额外等 5 秒且仍受共享总期限；不自动滚动、翻页或点击。
- script/fetch/XHR 失败包括 CSP 提前阻断时均拒绝结果；图片/字体/媒体/CSS 限制可警告继续。禁止的其他请求按安全失败处理。
- 无 Cookie、登录、云 Key、作者数据、Node、preload、WebView、DevTools；不解除原站 CSP。
- 作品 v7→v8、新快照 payload3、旧 payload1/2 和归档 v4～v7 保持兼容；不重写历史字节/hash。
- 每项实现先 RED→GREEN，验证后中文原子提交；超过 500 行的改动必须拆分。

## Review Focus

1. 页面脚本无限循环：主进程期限仍生效，只终止确认属于任务的独立 renderer（任务 4、7）。
2. CSP 在网络拦截前拒绝正文接口：观察失败必须拒绝提取，不能返回假成功（任务 3、4、7）。
3. 重定向和压缩资源累计超过预算：全部跳转计数和字节累计，终止在途与排队任务（任务 2）。
4. 旧快照字段缺失或哈希损坏：先验证原 hash，旧数据仅内存补空，新数据严格拒绝未知字段（任务 5）。
5. 作者换作品/来源或退出时迟到结果：不得替换当前草稿，清理失败阻止下一任务（任务 4、6）。

## 调度与依赖

GSD Core 波次：任务 1→2→3→4；任务 5 在任务 1 后可独立进行；4、5→6→7→8。共享主进程接线和设置文件由集成任务顺序修改。执行前依 using-git-worktrees 规章检查工作区，使用 codex/ 前缀功能分支；不复制作者数据。

### 任务 1：政策、状态与来源协议

**Files:** 新建 src/main/restricted-render-policy.ts、src/shared/source-capture.ts；修改 src/shared/book-extraction.ts、src/shared/source-document.ts；测试 tests/unit/restricted-render-policy.test.ts、tests/unit/source-capture.test.ts。

**Interfaces:** 定义 WebImportRequest.mode?: 'static' | 'restricted-browser'；SourceCapture 为严格判别联合：static 记录 capturedAt/policyVersion=1，restricted-browser 另含 renderedDomHash，均附 sourceId；旧记录无 capture。FrozenSourceDocument.capture 可选并核对 sourceId/kind。renderLimits 为以上固定限额；RenderCapability 含 enabled、policyVersion=1、message，主进程只读加载固定构建资格。

- [x] 已补省略mode默认static、未知mode/额外字段、捕获hash/时间/sourceId、旧来源无capture及默认禁用回归；`2cccd00` 有44项相关 GREEN 证据。
- [ ] 原始 RED：运行 npx vitest run tests/unit/restricted-render-policy.test.ts tests/unit/source-capture.test.ts，确认失败来自未实现接口；现有 ledger 未逐命令保留该失败，不反推完成。
- [x] 实现类型、白名单 schema、不可变限额和默认关闭资格；不开放生产绕过开关（`2cccd00`）。
- [x] 政策/捕获专项验证并提交 `2cccd00`；最终完整类型检查另由任务8记录。

### 任务 2：同源资源 broker 与共享预算

**Files:** 新建 src/main/render-resource-broker.ts；修改 src/main/public-web-transport.ts，仅提取可复用的固定 IP/解压核心；测试 tests/unit/render-resource-broker.test.ts、tests/unit/public-web-transport.test.ts。

**Interfaces:** RenderResourceBroker.fetch(url: string, resourceType: string, signal: AbortSignal): Promise<{ bytes: Buffer; contentType: string; headers: Record<string,string> }>，close(): Promise<void>。构造输入为 initialUrl、deadline、signal、测试依赖；初始文档后锁定 finalOrigin。类型来自宿主请求事件，不从 MIME 猜测；broker 自行核对响应 MIME。

- [x] 已补固定IP、地址/方法限制、并发/请求/字节预算及取消回归；`406bc46` 33项、`a740fca` 14项专项证据，边界回归见 `ac2143f`。
- [ ] 原始 RED：运行 npx vitest run tests/unit/render-resource-broker.test.ts tests/unit/public-web-transport.test.ts，确认新测试失败；原始失败记录未逐项核验，不以 GREEN 替代。
- [x] 实现同源 GET、流式双预算、固定请求头、响应头白名单与原站CSP保留（`406bc46`、`a740fca`）。
- [x] 编码补修先RED再六文件100项GREEN；`678f98b`保留原bytes证据，独立UTF-8 bodyBytes与meta规范、响应长度重算，声明冲突/数量/转码预算均拒绝。
- [x] broker专项验证后提交；`48ecc2f` 修复释放并发名额时的插队竞态。最终完整类型检查另记。

### 任务 3：session 网络与权限防护

**Files:** 新建 src/main/render-network-guard.ts、tests/unit/render-network-guard.test.ts、tests/fixtures/restricted-render/；修改 scripts/build-desktop.mjs（若新资源需独立打包）。

**Interfaces:** installRenderNetworkGuard(session, broker, signal): Promise<{ assertHealthy(): void; close(): Promise<void> }>。安装随机 loopback 拒绝代理，proxyBypassRules='<-loopback>'，等待设置生效并关闭旧连接；在卸除防护前关闭网络。broker 为任务 2 的唯一公网通道。

- [x] 已补会话、代理、协议/权限与清理回归；`6d47a2c` 5项TCP、`bb6691b` 20项、`04d905e` 6项专项通过。
- [ ] 原始 RED：运行 npx vitest run tests/unit/render-network-guard.test.ts，确认失败；现有 ledger 未保留逐命令失败，不反推。
- [x] 实现 protocol/webRequest/permission/认证拦截、CSP及隔离世界错误观察（`bb6691b`、`04d905e`）。
- [x] 网络防护与观察器专项验证后独立提交；真实旁路及系统证据仍由任务7验收，mock不代表隔离通过。

### 任务 4：独立窗口、DOM 与统一清理

**Files:** 新建 src/main/restricted-web-renderer.ts、src/main/render-dom-capture.ts、tests/unit/restricted-web-renderer.test.ts、tests/unit/render-dom-capture.test.ts。

**Interfaces:** renderPublicArticle(url: string, signal: AbortSignal): Promise<{ rawBytes: Buffer; finalUrl: string; capturedAt: string; domBytes: Buffer; renderedDomHash: string; warnings: string[]; deadline: number }>；captureBoundedDom(document, limits): string。任务 2/3 注入创建窗口和时钟依赖，生产不接受 renderer 指定路径/配置。

- [x] 已补期限、身份核验、取消/崩溃、DOM预算与清理失败回归（`9ed5ab1`、`42400a3`、`5cb0817`、`c9b2e69`）。
- [ ] 原始 RED：运行 npx vitest run tests/unit/restricted-web-renderer.test.ts tests/unit/render-dom-capture.test.ts，确认最初接口失败；无完整原始记录，不反推。
- [x] 实现隐藏sandbox窗口、独立身份核验、主进程看门狗与统一清理；`5cb0817` 协调观察器关闭与任务进程退出。
- [x] 审查新增DOM属性回归先3失败/9通过，再12项 GREEN；`ce30ec1` 将节点与属性共享预算、逐项读取，四维覆盖均≥80%。
- [x] 生命周期及DOM分步提交；初始化取消退出修复 `c9b2e69` 已提交。最终完整测试、类型检查与构建仍由任务8记录。

### 任务 5：来源关系迁移、快照与归档

**Files:** 修改 src/workers/database/{source-schema,source-document,source-copy,migration,schema,snapshots,snapshot-export,archive-project}.ts、src/main/{freeze-source,archive-commands}.ts、src/shared/source-assets.ts；新建 tests/unit/source-capture-migration.test.ts，更新 tests/unit/{source-migration,source-archive,source-document,knowledge-source-copy}.test.ts。

**Interfaces:** source_capture 表以 source_id 主键/外键保存 method、captured_at、rendered_dom_hash、policy_version；加入 sourceAssetTables。initializeSourceCapture(db): void；migrateProjectV7(db): void。SourceAssets.documents 通过 FrozenSourceDocument.capture 携带记录，不增设重复数组；读写对象与表关系互相核对。

- [x] 已补迁移备份/回滚、旧hash、payload3、归档、复制及草稿兼容回归；`0b1f817` 69项、`cb06ced` 67项、`c871425` 48项相关证据。
- [ ] 原始 RED：运行来源迁移/归档/复制命令并记录失败；现有 ledger 无逐命令完整记录，不反推。
- [x] 关系与迁移→payload3兼容→归档/复制与草稿codec分步实现提交（`0b1f817`、`cb06ced`、`c871425`）；保留旧schema参考。
- [x] 对应来源/快照/归档专项通过；最终全套及类型检查仍待任务8统一证据。

### 任务 6：主进程接线、确认 UI 与故障回退

**Files:** 修改 src/main/{web-extraction-commands,book-extraction-commands,index}.ts、src/shared/contracts.ts、src/preload/index.ts、src/renderer/components/{book-extraction-workspace,knowledge-source-audit}.tsx；测试 tests/unit/{web-extraction-commands,web-extraction-preload,book-extraction-workspace,knowledge-source-projections}.test.*。

**Interfaces:** WebExtractionDependencies.render?: typeof renderPublicArticle，能力查询 getWebRenderCapability(): Promise<RenderCapability> 进入可信 IPC 白名单。模式省略仍 fetchPublicArticle；渲染原 HTML 用于 rawHash，domBytes 交给 parseWebArticle，正文 bodyHash 规则不变。

- [x] 已补显式确认、资格失败禁用、网址改变、旧来源与草稿保护回归；接线35项、UI28项专项证据。
- [x] UI首次 RED 为2文件8失败/19通过；ledger记录其失败与后续 GREEN。该证据不代替其余模块的原始RED记录。
- [x] 实现显式入口、逐次确认、状态/取消、来源详情及可信sender接线（`9e0007d`、`881971b`）。
- [x] 接线与UI独立提交，限定Lint及对应专项通过；最终项目类型检查/Lint仍由任务8记录。

### 任务 7：实际 Electron/EXE 隔离验收

**Files:** 新建 tests/desktop/restricted-web-rendering.spec.cjs（产品UI/历史草稿）、tests/desktop/restricted-web-runtime.spec.cjs（真实渲染运行时）、scripts/qualify-restricted-render.mjs、tasks/restricted-render-qualification.md；新增核心模块已纳入 Vitest coverage 配置，最终158文件1477测试及核心覆盖率门禁通过。

**Interfaces:** 资格脚本只通过测试入口使用受控 DNS/监听目标，正式构建不存在旁路配置。输出记录包 SHA256、系统、Electron 版本、policyVersion、输入、网络连接/上传证据和清理结果；缺证据结果为 pending。

- [x] 已建真实渲染夹具并串行验证：inline/script/fetch/XHR、CSP提前拒绝、私网POST及无限循环取消；`91b95c3`、`e8b4d84` 记录6夹具通过、任务进程/窗口均无剩余。
- [x] 产品UI命令：`npx playwright test --config playwright.desktop.config.cjs tests/desktop/restricted-web-rendering.spec.cjs --output=test-results-restricted-ui`，4项通过（`e9f4d41`）；验证禁用入口、静态入口与三种合成历史来源草稿，不运行网页脚本。
- [x] 真实运行时命令：`npx playwright test --config playwright.desktop.config.cjs tests/desktop/restricted-web-runtime.spec.cjs --output=test-results-restricted-runtime`，1项/6夹具通过（20.6秒）；运行开发依赖Electron与独立测试bundle，DNS/传输注入，不等同最终产品包或全系统网络验收。
- [ ] 系统网络反例覆盖 DNS重绑定、IPv4/IPv6私网、跨源、WSS、WebRTC/STUN、QUIC/WebTransport、预取/DNS预取、全部 worker、iframe/srcdoc、blob/data、弹窗、下载和认证；受控监听证明禁止目标零连接/零上传，代理故障无直连。无可用系统观测时保留 pending。
- [ ] 用独立目录实际包验静态站及确需同源 JS 站；验证不继承 Cookie/Key/作品、取消后退出；脚本错误或验证码明确失败。新包不覆盖 release/current。
- [x] 生产资格缺失时默认禁用且无绕过；测试/验收记录分步提交。
- [ ] 全部门禁通过并绑定实际包hash后才生成固定构建能力记录；当前仍未放行。

### 任务 8：教材、文档、审查与交付

**Files:** 更新 docs/Rain_Soul_PRD.md、docs/Rain_Soul_技术方案.md、docs/Rain_Soul_项目立项方案_V2.0.md；新增 learning/项目全流程开发学习/09-来源与本机检索/04-受限浏览器与来源证据.md，更新 course.json；新增 tasks/restricted-render-ledger.md。

- [x] 教材/课程/产品文档与ledger已追加（`b674914`、`1169996`）；真实桌面截图来自隔离临时作品，保留旧教材；ledger区分已有RED/GREEN、提交与门禁边界。
- [x] 全项目typecheck/Lint/build、最终158文件1477测试通过，新增核心覆盖率≥80%；实际EXE32桌面与Demo74通过，构建提示已评估。
- [x] 已做独立专项审查并修复观察器清理、DOM属性、并发名额与初始化取消退出；对应回归/提交有证据。
- [x] 稳定分支与最终编码/打包增量已独立复读，无确认High/Medium，受影响定向及全套门禁通过。
- [x] 新实际EXE720×540网页入口及键盘返回通过，无横向溢出/pageerror；32桌面场景含禁用能力与历史草稿取消/恢复。实际包hash见acceptance，可信渲染资格仍null，不能伪造启用。
- [x] 已有文档与教材中文独立提交；Claude Mem/Compound Engineering接口本轮不可用已如实记录，经验保存在教材/ledger，不写休眠gbrain。
- [x] 最终文档核对当前包/hash/数字和证据边界，中文原子提交后本地合并main；真实云、系统/实际产品渲染及干净Windows仍待验，不标最终发布完成。

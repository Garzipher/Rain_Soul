# 一次性受限网页渲染实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本项目按 AGENTS.md 优先采用 GSD Core 调度，保留 TDD、独立审查和验证模块。

**Goal:** 在拆书工具中提供经实际包隔离验收的显式网页渲染，并保存可追溯来源。

**Architecture:** 复用 Electron；Node 校验和固定公网 IP 获取初始 HTML，同源 GET broker 提供资源，一次性 session 的独立 renderer 产生有界 DOM。来源捕获记录独立存储，旧快照先校验原哈希再内存兼容。未通过网络反例门禁时渲染入口禁用。

**Tech Stack:** Electron 44.7.0、Node HTTPS、React/TypeScript、SQLite、Readability worker、Vitest、Playwright。

**Spec:** [已确认规格](../specs/2026-10-12-restricted-web-rendering-design.md)。状态：用户已批准并授权实施；实现与专项验证进行中，逐项证据见 tasks/restricted-render-ledger.md。

## Global Constraints

- 默认 static，只有显式确认才运行 restricted-browser；不自动重试或回退为直连。
- HTTPS/443、无网址凭据、公网域名、每跳 DNS 全结果验证并固定 IP；最多三次重定向，子资源固定最终 origin 且只接受 GET。
- 共享总期限 40 秒，初始最多 30 秒；最多 80 请求、4 并发。单响应压缩 2 MiB/展开 5 MiB，全任务压缩 12 MiB/展开 24 MiB，重定向正文也计入。
- DOM 最多 20,000 节点、序列化 UTF-8 最多 5 MiB；正文最多 200,000 Unicode 字符/2,000 非空段落。先有界遍历再序列化。
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

- [ ] RED：测试省略 mode 等于 static，未知 mode/额外字段拒绝；restricted capture 缺 hash、坏时间、sourceId 不匹配拒绝；旧来源无 capture 可读取；未有资格记录 enabled=false。
- [ ] 运行 npx vitest run tests/unit/restricted-render-policy.test.ts tests/unit/source-capture.test.ts，确认失败来自未实现接口。
- [ ] 实现类型、白名单 schema、不可变限额和默认关闭资格；不开放生产绕过开关。
- [ ] 重跑上述测试及 npm run typecheck，要求通过；提交 feat(网页): 定义受限渲染政策与来源捕获协议。

### 任务 2：同源资源 broker 与共享预算

**Files:** 新建 src/main/render-resource-broker.ts；修改 src/main/public-web-transport.ts，仅提取可复用的固定 IP/解压核心；测试 tests/unit/render-resource-broker.test.ts、tests/unit/public-web-transport.test.ts。

**Interfaces:** RenderResourceBroker.fetch(url: string, resourceType: string, signal: AbortSignal): Promise<{ bytes: Buffer; contentType: string; headers: Record<string,string> }>，close(): Promise<void>。构造输入为 initialUrl、deadline、signal、测试依赖；初始文档后锁定 finalOrigin。类型来自宿主请求事件，不从 MIME 猜测；broker 自行核对响应 MIME。

- [ ] RED：固定公网 IP/TLS 原域名；混合 DNS/IPv6 私网、跨源跳转、凭据网址、POST 拒绝；第 81 请求、第 5 并发排队；累计压缩/展开预算包含重定向正文；取消排队与挂起 DNS 不发晚请求。
- [ ] 运行 npx vitest run tests/unit/render-resource-broker.test.ts tests/unit/public-web-transport.test.ts，确认新测试失败、原路径基线明确。
- [ ] 实现同源 GET、流式双预算、固定请求头、响应头白名单；剔除 Cookie/Refresh/Link/报告/旧压缩长度，保留原 CSP 交集并正确重算长度和编码。
- [ ] 重跑相关测试及类型检查；静态 30 秒和失败分类不变。拆开 transport 重构和 broker 功能提交，均附中文说明。

### 任务 3：session 网络与权限防护

**Files:** 新建 src/main/render-network-guard.ts、tests/unit/render-network-guard.test.ts、tests/fixtures/restricted-render/；修改 scripts/build-desktop.mjs（若新资源需独立打包）。

**Interfaces:** installRenderNetworkGuard(session, broker, signal): Promise<{ assertHealthy(): void; close(): Promise<void> }>。安装随机 loopback 拒绝代理，proxyBypassRules='<-loopback>'，等待设置生效并关闭旧连接；在卸除防护前关闭网络。broker 为任务 2 的唯一公网通道。

- [ ] RED：未就绪不导航；无 DIRECT/PAC 回退；https handler 不调用 Chromium fetch；WSS/权限/认证/下载/外部协议拒绝；代理关闭不直连；清理次序与失败传播。
- [ ] 运行 npx vitest run tests/unit/render-network-guard.test.ts，确认失败。
- [ ] 实现 protocol/webRequest/permission/认证拦截及不可移除 CSP；建立有界隔离世界错误观察，CSP violation、脚本错误、fetch/XHR 失败及观察失效均使 assertHealthy 抛错。
- [ ] 重跑测试及类型检查，提交 feat(网页): 建立受限会话网络防护。真实旁路证据留给任务 7，不把 mock 视为隔离通过。

### 任务 4：独立窗口、DOM 与统一清理

**Files:** 新建 src/main/restricted-web-renderer.ts、src/main/render-dom-capture.ts、tests/unit/restricted-web-renderer.test.ts、tests/unit/render-dom-capture.test.ts。

**Interfaces:** renderPublicArticle(url: string, signal: AbortSignal): Promise<{ rawBytes: Buffer; finalUrl: string; capturedAt: string; domBytes: Buffer; renderedDomHash: string; warnings: string[]; deadline: number }>；captureBoundedDom(document, limits): string。任务 2/3 注入创建窗口和时钟依赖，生产不接受 renderer 指定路径/配置。

- [ ] RED：主窗口和任务 renderer 不同进程；500ms 安静/5 秒等待/40 秒总期限；20,001 节点或 5 MiB+1 不创建巨大 outerHTML；死循环/取消/崩溃清理；PID 已复用不得杀进程；清理失败阻止新任务。
- [ ] 运行 npx vitest run tests/unit/restricted-web-renderer.test.ts tests/unit/render-dom-capture.test.ts，确认失败。
- [ ] 实现无 preload 的隐藏 sandbox 窗口、独立进程核对、主进程看门狗及 finally 清理；销毁后确认退出，必要时仅结束已确认仍属该任务的进程。有界 DOM 不加载到作者窗口。
- [ ] 重跑测试与类型检查，分别提交 DOM 捕获和窗口生命周期；任何任务改动超过 500 行拆分。

### 任务 5：来源关系迁移、快照与归档

**Files:** 修改 src/workers/database/{source-schema,source-document,source-copy,migration,schema,snapshots,snapshot-export,archive-project}.ts、src/main/{freeze-source,archive-commands}.ts、src/shared/source-assets.ts；新建 tests/unit/source-capture-migration.test.ts，更新 tests/unit/{source-migration,source-archive,source-document,knowledge-source-copy}.test.ts。

**Interfaces:** source_capture 表以 source_id 主键/外键保存 method、captured_at、rendered_dom_hash、policy_version；加入 sourceAssetTables。initializeSourceCapture(db): void；migrateProjectV7(db): void。SourceAssets.documents 通过 FrozenSourceDocument.capture 携带记录，不增设重复数组；读写对象与表关系互相核对。

- [ ] RED：v7 备份失败零修改/事务回滚；新 v8 库含关系；所有旧版本到 v8；payload1/2 原 hash 先检查且存储字节不变，payload3 恢复/历史导出保留证据；归档 v4～v8、草稿恢复、跨作品复制完整往返；坏关系/未知字段拒绝。
- [ ] 运行 npx vitest run tests/unit/source-capture-migration.test.ts tests/unit/source-migration.test.ts tests/unit/source-archive.test.ts tests/unit/knowledge-source-copy.test.ts，记录 RED。
- [ ] 分三步实现：关系与迁移→payload3 兼容→归档/复制与草稿 codec。每步相关测试 GREEN 后独立提交；旧 schema 参考仍保留，不用新表集合误判旧归档。
- [ ] 运行全部来源/快照/归档测试及类型检查，要求旧作者资料和正文不变。

### 任务 6：主进程接线、确认 UI 与故障回退

**Files:** 修改 src/main/{web-extraction-commands,book-extraction-commands,index}.ts、src/shared/contracts.ts、src/preload/index.ts、src/renderer/components/{book-extraction-workspace,knowledge-source-audit}.tsx；测试 tests/unit/{web-extraction-commands,web-extraction-preload,book-extraction-workspace,knowledge-source-projections}.test.*。

**Interfaces:** WebExtractionDependencies.render?: typeof renderPublicArticle，能力查询 getWebRenderCapability(): Promise<RenderCapability> 进入可信 IPC 白名单。模式省略仍 fetchPublicArticle；渲染原 HTML 用于 rawHash，domBytes 交给 parseWebArticle，正文 bodyHash 规则不变。

- [ ] RED：未确认零请求；能力未验禁用；确认展示网址/脚本/限制/40秒；取消/换作品/旧回执不替换草稿；失败保留审核建议；原 HTML、DOM、正文三 hash 各自正确。
- [ ] 运行相关组件/命令测试，确认新用例失败。
- [ ] 实现显式入口、每次确认、状态和取消；来源详情显示捕获方式、限制警告；不合并云授权与网页授权。主进程只信任应用窗口 sender。
- [ ] 重跑相关测试、npm run typecheck 和 npm run lint；UI 与接线独立提交。

### 任务 7：实际 Electron/EXE 隔离验收

**Files:** 新建 tests/desktop/restricted-web-rendering.spec.cjs、scripts/qualify-restricted-render.mjs、tasks/restricted-render-qualification.md；增加 Vitest coverage 中所有新增核心模块。

**Interfaces:** 资格脚本只通过测试入口使用受控 DNS/监听目标，正式构建不存在旁路配置。输出记录包 SHA256、系统、Electron 版本、policyVersion、输入、网络连接/上传证据和清理结果；缺证据结果为 pending。

- [ ] 先建真实渲染夹具：inline/script/fetch/XHR 生成文章；CSP 比 webRequest 更早拦截；无限循环与退出；仅 mock 窗口不能通过。
- [ ] npx playwright test --config playwright.desktop.config.cjs tests/desktop/restricted-web-rendering.spec.cjs；确认真实脚本运行与正确拒绝。
- [ ] 系统网络反例覆盖 DNS重绑定、IPv4/IPv6私网、跨源、WSS、WebRTC/STUN、QUIC/WebTransport、预取/DNS预取、全部 worker、iframe/srcdoc、blob/data、弹窗、下载和认证；受控监听证明禁止目标零连接/零上传，代理故障无直连。无可用系统观测时保留 pending。
- [ ] 用独立目录实际包验静态站及确需同源 JS 站；验证不继承 Cookie/Key/作品、取消后退出；脚本错误或验证码明确失败。新包不覆盖 release/current。
- [ ] 全部门禁通过才生成固定构建能力记录；未过按钮保持禁用。测试/验收记录分别提交。

### 任务 8：教材、文档、审查与交付

**Files:** 更新 docs/Rain_Soul_PRD.md、docs/Rain_Soul_技术方案.md、docs/Rain_Soul_项目立项方案_V2.0.md；新增 learning/项目全流程开发学习/09-来源与本机检索/04-受限浏览器与来源证据.md，更新 course.json；新增 tasks/restricted-render-ledger.md。

- [ ] 按原理→实际源码→系统截图→跟做→练习编写；截图来自当前实现，保护作者已编辑的教材。任务 ledger 保留 RED/GREEN 命令、commit、审查发现和门禁证据。
- [ ] 运行 npm run typecheck、npm run lint、npm test、npm run build；coverage 所有阈值≥80%，评估全部构建警告。
- [ ] 按 review 与 requesting-code-review 独立审阅本分支完整 diff，重点查网络旁路/来源兼容/取消；修复后重复受影响验证，High/安全/性能问题不交付。
- [ ] 必要 UI 手动验证键盘、确认/取消/失败、窄窗；实际包 SHA256 与资格记录一致。
- [ ] 文档验证后独立中文提交，再交付功能状态/包路径/剩余门禁；真实云和干净 Windows 未验项仍单列，禁止标为最终发布完成。按 Claude Mem/Compound Engineering 现有可用接口沉淀，接口不可用如实记录。

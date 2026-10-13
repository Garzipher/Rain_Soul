# 内置语义检索模型实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本项目依 AGENTS.md 优先使用 GSD Core 调度，保留 TDD、独立审查和交付验证。

**Goal:** 让安装包携带经过来源核验的中文检索模型，离线加载并保留作者启停及来源选择。

**Architecture:** 固定本地输入经校验后进入 extraResources，主进程从可信安装目录只读加载。用户目录只保存偏好、手动副本及派生索引；来源、资格、启用和索引状态分别报告，未达门禁时继续关键词检索。

**Tech Stack:** Electron 44.7.0、React/TypeScript、固定 Tokenizer/ORT CPU WASM、Node 文件校验、Vitest、Playwright、electron-builder。

**Spec:** [已确认规格](../specs/2026-10-12-bundled-embedding-model-design.md)。状态：实施计划待用户审阅，未开始产品实现。

## Global Constraints

- 固定候选 Xenova/bge-small-zh-v1.5，revision 75c43b069aac4d136ba6bc1122f995fedcfd2781；五运行文件合计 24,451,175 字节，约 23.32 MiB，不等于安装器实测增量。
- Tokenizers 0.2.0、ORT 1.31.0-dev.20260914-8d85527a0、CPU WASM、512维、CLS/L2；分块/前缀/指纹沿用当前 manifest。
- 权重 dist/retrieval-model/<revision>/weights/ → resources/retrieval-model/<revision>/weights/；notices 单独目录，禁止混入精确白名单 weights。
- 不首启下载、不自动联网修复；手动下载/导入仍是显式修复入口。
- 官方来源、转换 revision、系统网络审计、实际包运行、独立质量五资格分别有证据才放行；来源和许可不足禁止对外捆绑权重发布。
- 旧 active.json 的 enabled 和来源保留；false 不推断为作者手动停用，明确提示保留旧禁用记录。损坏的明确选择不静默切换。
- 模型/索引不进入作品归档；不修改作品 schema；无本机生成模型。
- 加载 30秒、宿主 RSS 增量目标≤1.5 GiB；不影响 500ms停顿/5秒持续输入保存。
- 中文小步提交，核心变更先 RED→GREEN，超过500行必须拆分；所有门禁未齐不宣称最终发布完成。

## Review Focus

1. 旧 false 来自自动资格禁用：保持值并解释，不替作者决定启用（任务3）。
2. 用户选择损坏副本而内置有效：回退关键词，等待显式换源（任务3、4）。
3. 构建残留旧资源：缺少当前来源/文件证据不得沿用旧 dist 权重打包（任务1、2）。
4. 换源/停用过程中迟到索引结果：代号/CAS作废，不能污染新缓存（任务4）。
5. 升级后的只读资源和用户记录版本不一致：保留原记录，显示不兼容，不启用其他模型（任务3、5）。

## 调度与依赖

GSD Core 波次：任务1→2；任务3可与2独立执行；2、3→4→5→6。网页计划和本计划共享 index.ts/设置接线由主集成者顺序修改。模型来源证据无法取得时可完成分发基础设施，但不得伪造资格或发布含不明权重的安装包。

### 任务1：来源证据协议与构建准备

**Files:** 新建 scripts/prepare-bundled-retrieval-model.mjs、对应 .d.mts、tests/unit/bundled-retrieval-model.test.ts；修改 tasks/retrieval-model-qualification.md，必要时新增 assets/retrieval-model-provenance.json。

**Interfaces:** prepareBundledRetrievalModel({inputDirectory, evidenceDirectory, outputDirectory, manifest}): Promise<void>；validateModelProvenance(evidence, manifest): void。固定输入不来自 renderer；证据记录上游/转换 revision、官方获取网址/时间、字节hash、模型卡和许可证。权重长度/hash逐项等于 fixedManifest。

- [ ] RED：五文件正确成功；缺文件/坏长度/hash/未知文件/链接/越界拒绝；许可或精确转换源证明缺失不生成正式资源；旧输出不能使失败构建通过；无隐式网络。
- [ ] 运行 npx vitest run tests/unit/bundled-retrieval-model.test.ts，记录新接口缺失的失败。
- [ ] 实现固定本地输入验证、隔离临时输出和完整成功后的原子发布；校验逻辑复用或提取 validateModelDirectory，避免两个不同白名单。提取时不改变现有安装行为。
- [ ] 取得固定官方模型卡、许可及转换精确源证明；若转换源仍不明，按规格另行制定固定上游导出/量化步骤并重做指纹与验证，禁止冒用旧资格。
- [ ] 重跑测试、npm run typecheck；基础设施与来源证据分别提交。证据不足写 pending，不把布尔字段改为 true。

### 任务2：安装资源接线与包结构校验

**Files:** 修改 scripts/pack-desktop.mjs、package.json；新增 scripts/check-bundled-model-package.mjs、tests/unit/bundled-model-package.test.ts；必要时修改 scripts/build-desktop.mjs。

**Interfaces:** checkBundledModelPackage(resourcesDirectory: string, manifest): Promise<void>；打包脚本显式接受已准备的模型资源并调用任务1校验，extraResources 到 retrieval-model/<revision>。开发无权重构建允许，但状态必须为未捆绑；研究包单独标识且语义禁用。

- [ ] RED：weights与notices分开且manifest五文件完整；准备失败阻断捆绑；旧dist/缺notice/错误revision拒绝；作者库、凭据、研究日志不能入包；研究包不覆盖 release/current。
- [ ] 运行 npx vitest run tests/unit/bundled-model-package.test.ts，确认新测试失败。
- [ ] 实现资源接线与检查，保持现有 ASAR完整性和Windows重试逻辑；默认打包行为及是否含权重必须明确报告，禁止静默遗漏。
- [ ] 重跑相关测试及 npm run build；提交 chore(打包): 纳入经核验的本机模型资源。生产包增量后续实测。

### 任务3：内置来源与旧偏好迁移

**Files:** 修改 src/main/retrieval-model-store.ts、src/shared/retrieval-model.ts；新增 src/main/retrieval-model-selection.ts、tests/unit/retrieval-model-selection.test.ts；更新 tests/unit/retrieval-model-store.test.ts。

**Interfaces:** Dependencies.bundledDirectory?: string 为主进程可信路径；版本化 selection.json 区分 source:'bundled'|'user'、userGeneration、fingerprint、enabled 和 legacyDisabled。新增 store.selectSource(source:'bundled'|'user'): Promise<void>；getStatus() 新增 source、bundledPresent、enabled、legacyDisabled 可选字段，保留原兼容字段；getActiveDirectory() 仍返回经完整校验且资格通过的目录或 null。

- [ ] RED：新用户内置候选、只读无复制；五资格任一false零推理；旧enabled/手动generation原样迁移；旧false显示保留禁用；明确手动来源优先，损坏不暗换；坏选择记录保留；版本不匹配不覆盖旧记录。
- [ ] 运行 npx vitest run tests/unit/retrieval-model-selection.test.ts tests/unit/retrieval-model-store.test.ts，确认失败。
- [ ] 先实现原子有界选择记录与幂等迁移，再接入store候选；首次失败不删除active.json，每次启动不重新install；停用跨启动/升级保留。两步各自测试提交。
- [ ] 重跑上述测试及类型检查；不改变作品和RetrievalCache归档边界。

### 任务4：主进程、切换取消与设置体验

**Files:** 修改 src/main/{index,retrieval-commands}.ts、src/shared/contracts.ts、src/preload/index.ts、src/renderer/components/retrieval-model-panel.tsx；测试 tests/unit/{retrieval-commands,retrieval-model-panel,retrieval-preload,retrieval-client}.test.*。

**Interfaces:** 主进程注入 process.resourcesPath 下固定revision的weights；新增 selectRetrievalModelSource({source:'bundled'|'user'}) 可信命令。切换/停用先 modelGeneration++、停止worker、清indexed，再原子更新偏好；查询回执同时核对来源/指纹/代号。

- [ ] RED：renderer不能提交任意路径；开关/换源取消旧查询；迟到结果回退且不污染缓存；资格未过无worker；设置分别展示文件/来源/资格/启用/索引；键盘可操作；不存在权重显示本构建未捆绑。
- [ ] 运行相关命令和组件测试，记录RED。
- [ ] 接线可信来源，界面显示模型版本/来源/许可/大小与修复方式；正常内置无需下载。现有download/import取消、空间不足和失败保护继续工作。
- [ ] 重跑相关测试、npm run typecheck、npm run lint；主进程接线与UI分提交。

### 任务5：实际包离线、性能、质量与资格

**Files:** 更新 scripts/qualify-retrieval-model.mjs、scripts/qualify-retrieval-performance.mjs、tests/desktop/local-retrieval.spec.cjs、tasks/retrieval-model-qualification.md；新增 tests/desktop/bundled-model.spec.cjs；新增模块进入 vitest.config.mts coverage。

**Interfaces:** 验收使用当前实际EXE路径及manifest指纹，报告资源hash、包hash、系统、计时/内存、网络证据及质量集版本。不得通过产品环境变量临时置真资格；研究入口与正式包隔离。

- [ ] 先编写桌面场景：只读资源加载、重启停用保持、换源/损坏回退、索引与持续保存并行；测试数据隔离，不用作者作品。
- [ ] 来源许可允许后在独立目录构建研究包；执行 npx playwright test --config playwright.desktop.config.cjs tests/desktop/bundled-model.spec.cjs；未过来源不对外分发候选权重。
- [ ] 断网启动并系统观测零CDN/遥测/文本外发，分别记录断网成功和零出站证据；首屏/保存不阻塞；加载≤30秒、宿主RSS增量≤1.5GiB；取消/异常终止worker。
- [ ] 千条知识/200查询暖态P95≤1秒；记录冷加载、首次索引、内存、真实安装器增量；独立人工质量集≥100条知识/30查询，语义改写混合Recall@5≥0.8且不低于关键词，5个无相关查询最多1次误报，校准与验收集分开。
- [ ] 每资格都关联当前来源/指纹/包证据后分别放行，任一缺失仍禁用；研究旧报告不复用为正式包证据。验收记录与资格变更独立审阅提交。

### 任务6：教材、产品文档与最终门禁

**Files:** 新增 learning/项目全流程开发学习/09-来源与本机检索/05-内置模型资源与资格验收.md，更新course.json；修改 docs/Rain_Soul_PRD.md、docs/Rain_Soul_技术方案.md、docs/Rain_Soul_项目立项方案_V2.0.md；新增 tasks/bundled-model-ledger.md。

- [ ] 教材讲清嵌入/生成、Tokenizer/WASM、指纹/只读资源、迁移、许可/质量/网络证据；按原理→当前源码→真实截图→跟做→练习组织，保护作者已编辑章节。ledger保存测试RED/GREEN、原子commit及审阅意见。
- [ ] 运行 npm run typecheck、npm run lint、npm test、npm run build；coverage所有阈值≥80%，无未评估警告；新实际包检查通过。
- [ ] 按review与requesting-code-review独立审阅完整功能分支，处理来源信任/偏好迁移/迟到回执/秘密入包风险；High/安全/性能问题阻断交付。
- [ ] 设置UI手动核查窄窗/键盘、停用/损坏/修复；记录当前EXE路径/hash与内置实际状态。真实云与干净Windows安装/升级/卸载待验仍单独列出。
- [ ] 文档独立中文提交，交付功能/证据/限制；通过现有可用Claude Mem/Compound Engineering接口沉淀，不擅自创建新的记忆数据库。

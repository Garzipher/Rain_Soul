# 内置语义检索模型实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本项目依 AGENTS.md 优先使用 GSD Core 调度，保留 TDD、独立审查和交付验证。

**Goal:** 让安装包携带经过来源核验的中文检索模型，离线加载并保留作者启停及来源选择。

**Architecture:** 固定本地输入经校验后进入 extraResources，主进程从可信安装目录只读加载。用户目录只保存偏好、手动副本及派生索引；来源、资格、启用和索引状态分别报告，未达门禁时继续关键词检索。

**Tech Stack:** Electron 44.7.0、React/TypeScript、固定 Tokenizer/ORT CPU WASM、Node 文件校验、Vitest、Playwright、electron-builder。

**Spec:** [已确认规格](../specs/2026-10-12-bundled-embedding-model-design.md)。状态：用户已批准并授权实施；基础设施已实现，新无模型研究安装器/实际EXE32场景通过，来源与正式资格待证据；见 tasks/bundled-model-ledger.md。

**进度口径（2026-10-13）：** 勾选仅表示已有实现或对应证据；原始RED缺记录不从GREEN反推，专项不相加。最新研究安装器及实际EXE32桌面场景、74Demo、最终资源审计和小窗口检查通过，独立代码review完成；最终源码158文件/1477测试及核心覆盖率门禁通过，详见ledger。模型来源/五资格、系统网络、产品EXE实际动态渲染、真实云和干净Windows继续pending。

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

- [x] 已补五文件/长度/hash/白名单/链接/来源不足/旧输出回归；`a66e9db` 有29项相关 GREEN 证据，真实官方来源仍未取得。
- [ ] 原始 RED：运行 npx vitest run tests/unit/bundled-retrieval-model.test.ts，记录新接口缺失的失败；ledger无逐命令原始失败，不反推。
- [x] 固定容量读取缺陷有独立RED→GREEN记录：并发增长不能使读取超出声明长度+1字节。
- [x] 实现固定本地输入校验、隔离临时输出及成功后的原子发布（`a66e9db`）；来源默认可信锚为null，正式入口保持拒绝。
- [ ] 取得固定官方模型卡、许可及转换精确源证明；若转换源仍不明，按规格另行制定固定上游导出/量化步骤并重做指纹与验证，禁止冒用旧资格。
- [x] 基础设施相关专项通过并独立提交；源码/CLI不允许外部锚放行，缺证据继续pending、资格false。
- [ ] 取得完整来源证据后独立审阅/提交；最终项目类型检查另由任务6记录。

### 任务2：安装资源接线与包结构校验

**Files:** 修改 scripts/pack-desktop.mjs、package.json；新增 scripts/check-bundled-model-package.mjs、tests/unit/bundled-model-package.test.ts；必要时修改 scripts/build-desktop.mjs。

**Interfaces:** checkBundledModelPackage(resourcesDirectory: string, manifest): Promise<void>；打包脚本显式接受已准备的模型资源并调用任务1校验，extraResources 到 retrieval-model/<revision>。开发无权重构建允许，但状态必须为未捆绑；研究包单独标识且语义禁用。

- [x] 已补weights/notices、准备/旧revision/来源失败及研究目录隔离回归（`064a466` 23项专项）；默认builder旁路由 `d93f54f` 阻断。
- [ ] 原始 RED：运行 npx vitest run tests/unit/bundled-model-package.test.ts，确认新接口失败；原始逐命令记录未核验，不反推。
- [x] 实现extraResources/正式来源门禁/显式无模型研究模式，保留ASAR完整性及Windows重试逻辑（`064a466`、`d93f54f`）。
- [x] 实际ASAR与解包树审计已实现（`5ae2eee`）；审查回归先5失败/48通过，再修复敏感存储名、空文件旁树字节及报告重复写入。
- [x] `4a97835`、`d537676` 后最终60项专项通过，两个模块四维覆盖≥80%，限定Lint/类型检查通过；原子替换失败保留旧记录、清理tmp并拒绝junction。
- [x] 最终研究安装器与EXE审计通过，6805文件/119解包成员；afterPack及构建末尾均复审，实际EXE再次独立重算。真实有模型包和模型安装器增量仍待来源门禁。

### 任务3：内置来源与旧偏好迁移

**Files:** 修改 src/main/retrieval-model-store.ts、src/shared/retrieval-model.ts；新增 src/main/retrieval-model-selection.ts、tests/unit/retrieval-model-selection.test.ts；更新 tests/unit/retrieval-model-store.test.ts。

**Interfaces:** Dependencies.bundledDirectory?: string 为主进程可信路径；版本化 selection.json 区分 source:'bundled'|'user'、userGeneration、fingerprint、enabled 和 legacyDisabled。新增 store.selectSource(source:'bundled'|'user'): Promise<void>；getStatus() 新增 source、bundledPresent、enabled、legacyDisabled 可选字段，保留原兼容字段；getActiveDirectory() 仍返回经完整校验且资格通过的目录或 null。

- [x] 已补内置/手动来源、资格、迁移、损坏/旧版本与偏好回归；`3f4f843` 37项，首次导入默认偏好修复 `ddca699` 39项专项。
- [ ] 原始 RED：运行 selection/store命令确认接口失败；现有ledger无逐命令完整失败记录，不反推。
- [x] 已实现有界原子selection、旧记录迁移与可信store候选；`6ee801f` 增加旧指纹显式维护，保留enabled并备份原字节，48项专项。
- [x] 相关专项及限定类型检查通过；最终完整门禁见任务6，未改变作品和检索缓存归档边界。

### 任务4：主进程、切换取消与设置体验

**Files:** 修改 src/main/{index,retrieval-commands}.ts、src/shared/contracts.ts、src/preload/index.ts、src/renderer/components/retrieval-model-panel.tsx；测试 tests/unit/{retrieval-commands,retrieval-model-panel,retrieval-preload,retrieval-client}.test.*。

**Interfaces:** 主进程注入 process.resourcesPath 下固定revision的weights；新增 selectRetrievalModelSource({source:'bundled'|'user'}) 可信命令。切换/停用先 modelGeneration++、停止worker、清indexed，再原子更新偏好；查询回执同时核对来源/指纹/代号。

- [x] 已补可信路径、generation/迟到回执、资格禁用与设置状态回归；`5f63f68` 34项、`48db4e3` 14项UI专项。
- [ ] 原始 RED：运行相关命令/组件测试记录失败；ledger未保留逐命令原始失败，不从GREEN反推。
- [x] 可信resourcesPath接线、切换取消与来源/文件/资格/启用状态UI分步提交（`5f63f68`、`48db4e3`），缺模型显示未捆绑。
- [x] 对应专项及限定静态检查已有证据；最终项目typecheck/lint仍由任务6统一记录。

### 任务5：实际包离线、性能、质量与资格

**Files:** tests/desktop/bundled-model.spec.cjs已新增；相关新模块已纳入vitest.config.mts coverage配置。scripts/qualify-retrieval-model.mjs、scripts/qualify-retrieval-performance.mjs仍为旧研究入口，当前不绑定实际EXE，不能当作本轮正式验收；有模型验收适配仍待来源证据。

**Interfaces:** 验收使用当前实际EXE路径及manifest指纹，报告资源hash、包hash、系统、计时/内存、网络证据及质量集版本。不得通过产品环境变量临时置真资格；研究入口与正式包隔离。

- [x] 已编写无模型实际EXE桌面场景（`f7e646d`）：临时目录、关键词/语义回退、停用重启与写作保存；未指定EXE明确skip，不记成功。
- [ ] 有模型实际包的只读加载、换源/损坏与索引/持续保存并行场景仍待来源许可和当前包。
- [x] 已在新独立目录构建显式无模型研究包并实际EXE定向通过1项（15.8秒，`32593b4`）；路径/hash见tasks/bundled-model-acceptance.md，仅对应旧产物。
- [x] 新无模型研究安装器UUID35492ba6生成，实际EXE完整32场景通过（含bundled-model）；最终ASAR、解包旁树与dist独立重算且匹配，详见实际包记录。
- [ ] 来源许可允许后才构建/验收含权重研究包；未过来源不对外分发候选权重。
- [ ] 断网启动并系统观测零CDN/遥测/文本外发，分别记录断网成功和零出站证据；首屏/保存不阻塞；加载≤30秒、宿主RSS增量≤1.5GiB；取消/异常终止worker。
- [ ] 千条知识/200查询暖态P95≤1秒；记录冷加载、首次索引、内存、真实安装器增量；独立人工质量集≥100条知识/30查询，语义改写混合Recall@5≥0.8且不低于关键词，5个无相关查询最多1次误报，校准与验收集分开。
- [x] 五资格缺失保持false、关键词回退；旧研究报告与无模型包未用于正式放行。
- [ ] 每资格关联当前来源/指纹/实际有模型包证据后独立审阅放行；来源、转换、系统网络、实际有模型运行与独立质量全部仍待证据。

### 任务6：教材、产品文档与最终门禁

**Files:** 新增 learning/项目全流程开发学习/09-来源与本机检索/05-内置模型资源与资格验收.md，更新course.json；修改 docs/Rain_Soul_PRD.md、docs/Rain_Soul_技术方案.md、docs/Rain_Soul_项目立项方案_V2.0.md；新增 tasks/bundled-model-ledger.md。

- [x] 第九卷教材/课程与产品文档已追加提交（`b674914`、`1169996`），包括真实无模型包截图与证据边界，保留旧章节与作者修改；ledger保存已知测试及提交。
- [x] 全项目typecheck/Lint/build、最终158文件1477测试通过，核心覆盖率≥80%；实际EXE32桌面与Demo74通过，构建提示已评估。
- [x] 已做来源/偏好/迟到回执/打包专项独立审查；偏好、旧指纹、builder旁路、真实成员与原子报告问题已回归修复提交。
- [x] 稳定分支及最终增量独立复核完成，无确认High/Medium；最终完整测试通过，证据见review/ledger。
- [x] 实际EXE720×540设置/键盘、停用与重启保持通过，记录当前路径/hash/未捆绑状态；损坏/修复由单元覆盖，真实有模型交互待验。真实云和干净Windows矩阵继续单列。
- [x] 已有中文文档/教材独立提交；Claude Mem/Compound Engineering接口不可用已如实记录，经验保存在教材/ledger，未创建替代库。
- [x] 文档已独立核对当前包/hash/数字和证据边界，中文原子提交后本地合并main；有模型、系统网络、真实云和干净Windows仍待验。

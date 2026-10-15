# RainSoul 全局知识库实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 项目调度以 AGENTS.md 指定的 GSD Core 为准；保留代码审查流程。用户已确认规格，本计划待审阅。

**Goal:** 建立供所有作品使用的独立全局知识库，连接拆书审核、本机检索、灰字提示和 AI 参考，并提供可核实的女频素材待审批次。

**Architecture:** 独立 SQLite 和数据库 worker 承担全局库读写，作品库保持独立。共享严格校验的契约、来源冻结和学习注释语义；作品实际使用全局知识时建立可追溯的冻结副本，检索索引是可重建缓存，来源文本不作为网页脚本或模型指令执行。

**Tech Stack:** Electron 44、React 19.3、TypeScript 6、better-sqlite3、Zod、现有本机 BGE 检索运行时、JSZip 和现有公开网页提取链路。

**Spec:** [已确认规格](../specs/2026-10-15-global-knowledge-library-design.md)

## Global Constraints

- 独立路径 `%LOCALAPPDATA%\RainSoul\GlobalKnowledge\knowledge.sqlite`，不属于某部作品，也不伪装成特殊作品。
- 全局库不可用不影响作品写作、保存、正文搜索和导出；关键词离线，语义模型未就绪回退关键词。
- 当前作品、全局库、当前作品+全局三种参考范围；旧“全部作品”汇总仍单独保留为只读，不改名冒充全局库。
- 作品归档只携带实际使用的冻结副本；全局库独立导入导出，不覆盖已有条目。
- 灰字顺序为当前作品已审核条目 → 全局已审核条目；只提示逐字可核对原句，未接受不保存、不计字数；AI 工具和输入法组合期间暂停。
- 新增全局 AI 参考必须显示其发送范围、服务和费用，作者确认后发送；不借此改回已整改的会话重复确认流程。
- 素材优先自有/授权、公有领域、允许再利用的开放文本；仅公开阅读的作品只做受限短摘录并逐条确认，不抓整章、整本，不绕访问限制。
- 互动量不是评分；原文、人工讲解、AI 建议分开；作者、章段和原文无法核实时不入库。
- 按用户要求，本轮不执行测试。新增核心逻辑可先写回归用例，但不运行、不声称通过；静态检查与构建结果单独报告。
- 中文注释、文档、提交信息；main 小步提交，超过 500 行拆分；不提交密钥、用户数据库、未确认小说正文。

## Review Focus

1. 全局库损坏、锁定或迁移失败：返回局部不可用状态，作品数据库仍可独立读写。
2. 使用全局条目时进程中断或重复提交：作品副本最多一份，使用台账可重建，不能误报复制失败让作者重复插入。
3. 来源条目编辑、删除或作品恢复旧快照：已冻结副本仍保留当时原文、讲解和版本。
4. 空查询、中文短词、同名分类、跨范围相同 ID 和翻页竞态：结果身份清晰，旧请求不能覆盖新范围。
5. 导入包损坏、路径穿越、哈希不符或摘录未获确认：不写正式库，不改旧条目，不将模型建议当作原文。

## 文件与依赖

新增 `src/workers/global-knowledge/` 隔离 schema、迁移、读写、来源和检索；新增 shared 契约以及主进程命令适配。复用现有正文提取、来源哈希、归档校验和检索运行时，禁止把整个作品仓储复制一套。

执行顺序：1 → 2 → 3；3 → 4 → 5；3 → 6 → 7 → 8；9 汇总。与动效计划共享的 renderer 文件串行修改；先保证业务接口再叠加动效。

### 任务 1：全局身份、查询和变更契约

**Files:** 新建 `src/shared/global-knowledge.ts`、`global-knowledge-schema.ts`；修改 `src/shared/knowledge-scope.ts`、`retrieval.ts`；用例 `tests/unit/global-knowledge-schema.test.ts`。

**Interfaces:** 导出 `KnowledgeLibraryTarget = { kind: 'work'; workId: string } | { kind: 'global' }`；`KnowledgeReferenceScope = { kind: 'work'; workId: string } | { kind: 'global' } | { kind: 'combined'; workId: string }`；`GlobalEntryRef = { entryId: string; revision: number }`。`GlobalKnowledgeEntry` 含 body/source/categoryId/tagIds/revision/deletedAt、sourceDocumentId/segmentId 和已审核状态；`GlobalKnowledgePage` 含 entries/categories/tags/total/revision。

- [ ] 先编写契约用例：拒绝缺 workId 的 work 范围、重复标签、非正版本、未验证来源标记；本轮不运行。
- [ ] 定义 `GlobalKnowledgeQuery`（text/categoryId/tagIds/offset/limit，limit 1–100）、`GlobalKnowledgeMutation`（operationId/expectedRevision/action）、`GlobalKnowledgeApi`。action 复用现有分类/标签/知识动作的字段语义，仅选取全局适用动作。
- [ ] 来源元数据扩展为独立 `GlobalSourceMetadata`，保存作者、作品、章节、rightsBasis、页面指标原字段与 capturedAt；不破坏旧 FrozenSourceDocument schema。
- [ ] 检索结果添加显式库身份，全局结果不捏造 workId；旧 retrieval 请求保持兼容，新增 scope 后校验旧字段不能与新范围矛盾。
- [ ] 静态检查后提交 `feat(knowledge): 定义全局知识库身份与契约`。

### 任务 2：独立存储、迁移和故障隔离

**Files:** 新建 `src/workers/global-knowledge/schema.ts`、`migration.ts`、`repository.ts`、`worker.ts`、`src/main/global-knowledge-client.ts`；修改 `scripts/build-desktop.mjs`；用例 `tests/unit/global-knowledge-repository.test.ts`、`global-knowledge-migration.test.ts`。

**Interfaces:** `GlobalKnowledgeRepository(directory: string)` 提供 `read(query: GlobalKnowledgeQuery): GlobalKnowledgePage`、`mutate(request: GlobalKnowledgeMutation): GlobalKnowledgePage`、`close(): void`；client 提供 `request(command, payload): Promise<unknown>` 与 `close(): void`。目录参数只由主进程固定生成。

- [ ] 先写创建、升级失败、重复 operationId、分类循环/删除迁移、软删除及锁定用例，不运行。
- [ ] 创建规格中的 global_category/tag/source_document/source_segment/knowledge_entry/learning_annotation/usage/search_document；增加 schema 版本、库版本和操作回执。建立人物、景物、内心、经典引用、剧情伏笔、叙事技巧、语言节奏分类，不自动植入小说原文。
- [ ] 使用 SQLite 一致性备份接口生成升级备份，确保 WAL 内容包含在快照中；失败恢复并禁止全局写入，不生硬复制运行中的 SQLite 主文件。
- [ ] 单独 worker 延迟初始化；失败只拒绝全局请求，不能让现有 database worker 退出。异常中不记录来源全文、凭据或用户正文。
- [ ] 补构建入口，类型检查、Lint、构建后分存储/迁移、worker 接线两次提交。

### 任务 3：IPC 与全局库管理界面

**Files:** 新建 `src/main/global-knowledge-commands.ts`、`src/renderer/lib/global-knowledge-controller.ts`；修改 `src/shared/contracts.ts`、`src/main/index.ts`、`src/preload/index.ts`、`src/renderer/App.tsx`、`components/knowledge-workspace.tsx`、`knowledge-dictionary.tsx`、`settings-page.tsx`；新增 `tests/unit/global-knowledge-commands.test.ts`、`global-knowledge-workspace.test.tsx`。

**Interfaces:** DesktopApi 扩展 GlobalKnowledgeApi：`readGlobalKnowledge(query)`、`manageGlobalKnowledge(request)`、`getGlobalKnowledgeStatus()`。所有方法只经白名单 IPC；渲染层不能指定数据库路径或提交 SQL。

- [ ] 先写来源/参数校验、范围切换旧回复丢弃、全局故障仍显示作品、分页分类标签用例，不运行。
- [ ] 命令层校验请求并映射可读局部错误；复用现有 p1-command-policy 的允许命令机制，补齐调用链，不能只加 preload 方法。
- [ ] 知识页明确区分当前作品、全局库、全部作品汇总；所有作品可访问同一全局库。卡片保持两行摘要、出处、原位展开，显示全局来源与版本。
- [ ] 全局分类维护放设置，标签维护放知识库；多标签 AND，搜索和分页保留；控制器使用 queryId 丢弃过时结果。新建作品不复制整库。
- [ ] 按契约接线、全局管理界面分提交；运行静态检查和构建，不运行 UI。

### 任务 4：冻结到作品与使用台账

**Files:** 新建 `src/main/global-knowledge-copy.ts`、`src/workers/database/global-knowledge-copy.ts`；修改 `src/shared/source-assets.ts`、作品 schema/迁移、`src/workers/database/worker.ts`、`src/main/store-service.ts`、`components/knowledge-copy-dialog.tsx`；新增 `tests/unit/global-knowledge-copy.test.ts`。

**Interfaces:** `freezeGlobalKnowledge({ workId, expectedRevision, operationId, entries: GlobalEntryRef[] }): Promise<WorkDetail>`；作品冻结来源另存 `GlobalKnowledgeOrigin`（entryId/revision/sourceHash/libraryId），不将 global ID 塞进现有 KnowledgeOrigin.workId。

- [ ] 先写重复操作、旧 revision、跨库写入中断、源更新/软删除和旧快照恢复用例，不运行。
- [ ] 主进程读取并校验已审核的指定全局版本，冻结正文、来源、分类/标签映射和讲解；作品 worker 一次事务写副本、来源关系与操作回执。
- [ ] 作品提交是成功判据；全局 usage 作为可修复台账异步幂等更新。台账失败不撤销或谎报作品提交失败；下次由作品回执修复，重试不能新增副本。
- [ ] 临时只读参考与已冻结副本在 UI 区分；正文正式引用必须已有作品副本。导出前列出仍临时使用的条目供确认冻结，失败保留原数据。
- [ ] 按来源迁移、复制事务、UI 接入拆提交；静态检查和构建。

### 任务 5：本机检索、灰字与 AI 参考

**Files:** 修改 `src/main/retrieval-commands.ts`、`src/shared/ai-reference.ts`、`src/main/ai-commands.ts`、`src/renderer/lib/knowledge-completion.ts`、`knowledge-ghost-extension.ts`、`components/chapter-editor.tsx`、`ai-workspace.tsx`；新增 `src/workers/global-knowledge/search.ts`、`src/shared/global-ai-reference.ts`。

**Interfaces:** `queryGlobalKnowledge(request: RetrievalQuery): Promise<RetrievalReply>` 由同一本机检索入口按 scope 路由；`findScopedKnowledgeCompletion(prefix, { workEntries, globalEntries }): KnowledgeCompletion | null` 保留原 findKnowledgeCompletion；`resolveGlobalAiReferences(refs: GlobalEntryRef[]): Promise<{ text: string; refs: GlobalEntryRef[] }>` 由命令层读取冻结版本。

- [ ] 先写 `tests/unit/global-knowledge-retrieval.test.ts`、`global-knowledge-completion.test.ts`、`global-ai-reference.test.ts`：同 ID 隔离、短词、AND、分页、无模型回退、原句优先级、版本变更使发送预览失效；不运行。
- [ ] 全局关键词沿用现有中文短词匹配策略；混合结果用库身份+条目 ID 去重。语义缓存绑定库身份、条目版本/哈希及模型指纹；全局缓存失败不阻塞作品结果。
- [ ] 灰字按作品优先再全局匹配；保持现有扫描预算、最多 160 字后缀、Tab/Esc 和输入法保护。全局灰字接受先确保冻结副本成功再插正文；失败保留原文，拒绝过时光标插入。
- [ ] AI 作者选择全局范围后展示实际条目及版本、服务与费用，确认对应请求哈希才发送；材料明确为引用数据，不执行其中指令。继续保留剧情、大纲、伏笔、风格上下文，不将知识原句拼贴成 AI 续写。
- [ ] 按检索、灰字、AI 三个独立提交；类型检查、Lint 和构建，不运行用例或真实云测试。

### 任务 6：拆书审核直达全局库

**Files:** 修改 `src/shared/book-extraction.ts`、`extraction-draft.ts`、`src/main/book-extraction-commands.ts`、`book-extraction-ai-commands.ts`、`extraction-draft-store.ts`、`src/renderer/components/book-extraction-workspace.tsx`、`book-extraction-ai-panel.tsx`；新增 `src/workers/global-knowledge/extraction.ts`、`tests/unit/global-book-extraction.test.ts`。

**Interfaces:** 新全局审核入口 `confirmGlobalBookExtraction(request): Promise<GlobalKnowledgePage>`，复用现有 preview token 与 segmentId；草稿绑定 KnowledgeLibraryTarget。旧作品确认入口维持兼容，主进程从 token 验证目标，不能由渲染层更换去向。

- [ ] 先写目标串改、摘录篡改、未确认、取消、重复 operationId、写入失败原子回滚用例；不运行。
- [ ] 复用 TXT/DOCX/粘贴/公开网页来源获取；全局模式不要求创建临时作品。草稿按目标身份分开，切换页面与 AI 失败后可恢复未审核内容。
- [ ] 来源→选段→学习卡→审核入库保留分页、滚动和出处；全局正式库存的来源段落只包含已批准短摘录，抓取全文不得持久化为正式库镜像。
- [ ] 原文从主进程可信预览按坐标获取，逐字核对；模型讲解单独保存，作者可改讲解但不能通过改 body 冒充原著。取消不入库，确认后来源/条目/注释/FTS/回执同事务写入。
- [ ] 按目标与草稿接线、审核事务、工作区拆提交；静态检查和构建。

### 任务 7：独立归档与作品可移植性

**Files:** 新建 `src/shared/global-knowledge-archive.ts`、`src/main/global-knowledge-archive.ts`、`src/workers/global-knowledge/archive.ts`；修改 `src/workers/database/archive-project.ts`、`source-copy.ts`、`components/settings-page.tsx`；新增 `tests/unit/global-knowledge-archive.test.ts`、更新 `tests/unit/source-archive.test.ts`。

**Interfaces:** `exportGlobalKnowledgeArchive(): Promise<boolean>`、`chooseGlobalKnowledgeArchive(): Promise<{ token: string; count: number } | null>`、`confirmGlobalKnowledgeArchive({ token, operationId }): Promise<GlobalKnowledgePage>`。包扩展名 `.rainsoulknowledge`，manifest v1，复用现有 ZIP 校验和保存临时文件/原子替换能力。

- [ ] 先写路径穿越、重复路径、压缩炸弹、哈希不符、取消、旧归档兼容和冻结副本离线导入用例；不运行。
- [ ] 导出只含正式审核条目及必要来源/注释，不含凭据、语义缓存和未审核全文；包上限沿用项目归档现有大小门槛，不放宽 ZIP 安全校验。
- [ ] 导入预览后 remap 全部身份和关系，生成新批次，operationId 幂等；同名不覆盖，校验失败不写库。
- [ ] 确保作品归档和快照携带已用副本来源；在没有全局库的另一台机器仍可追溯，不能误打包全局数据库。
- [ ] 按全局包、作品兼容两次提交；静态检查和构建。

### 任务 8：可核实素材待审批次

**Files:** 新建 `resources/knowledge-candidates/README.md`、`female-fiction-sources.json`；素材候选仅写本机未跟踪草稿，不提交抓取全文；修改全局拆书入口展示待审批次。

**Interfaces:** 每条候选记录 canonicalUrl/title/author/chapter/observedAt/metrics/rightsBasis/verificationStatus；metrics 保存原字段及时间，不能转换为 rating。已确认候选通过任务 6 的审核入口入库，不走隐式初始化 SQL。

- [ ] 重新读取规格列出的晋江官方目录和第 1 章，核对作者、作品名变化、章段和当前指标；旧观察值保留其原采集状态，不能伪装为本轮获取。
- [ ] 有效公开内容才生成少量待审短摘录和独立学习注释；仅公开阅读来源每部作品本批最多 3 条、累计不超过 300 个 Unicode 字符，不连续拼接整段章节。页面失效或受限就记录原因，不以转述补造原文。
- [ ] 显示来源、原文、出处、获取时间、指标事实与权利提示，逐条让作者确认；确认前不计入全局正式条目数量。不能把规格批准当成每条原文审核。
- [ ] 为元数据与审核闸门编写 `tests/unit/knowledge-candidate-schema.test.ts`，不运行；提交仅包含候选元数据、引用链接和审核界面，不包含未授权小说正文。

### 任务 9：代码审阅、教材与交付清单

**Files:** 修改 `README.md`、对应 PRD/技术方案的全局库章节、本计划；教材位于 `learning/项目全流程开发学习/`。

- [ ] 使用项目 review 技能审阅来源真实性、IPC、数据隔离、迁移、跨库回执、归档与 AI 范围；修复严重问题后提交。
- [ ] 运行 `npm run typecheck`、`npm run lint`、`npm run build` 和 `git diff --check`；记录真实结果，不运行测试、不标记 P0/P1 发布门禁通过。
- [ ] 教材先讲数据库归属、事务/幂等、FTS/向量、来源哈希原理，再对照本项目完整调用链与练习。截图只用实际取得的文件。
- [ ] 列出已实现、未测试、待作者审核素材、失败来源和待实际安装确认项；生成产物时只报告实际存在的最新版路径。
- [ ] 提交 `docs(knowledge): 更新全局知识库使用与实践教程`，确认 main 工作区没有误带用户数据库、来源全文、凭据和缓存。

## 计划自审

规格的数据归属、三种参考范围、作品冻结、独立归档、拆书审核、来源事实、故障隔离及候选素材均有对应任务。五项 Review Focus 分别落实到任务 2、4、4/7、3/5、6/7/8 的用例。规格中的“短摘录”在任务 8 明确首批数量上限，这是导入收敛参数，不是文学评分或版权许可判断。没有将待审核素材算作已经导入。

## 2026-10-15：四项后台失败修复记录

本轮基于 `5e71983`，仅处理首批素材及全局拆书审核中的四项失败，未调用真实云服务，未使用用户作品或凭据。

| 失败 | 修复与回归结果 |
| --- | --- |
| 原著第 4 段被重新编号成第 2 段 | 增加固定素材身份；主进程核对原文、出处后使用真实章段坐标。预览、草稿重开、入库和冻结副本均保留原段号；篡改身份或出处拒绝。 |
| 更换素材后保留上一部小说的互动指标 | 接受新素材时重置指标与使用依据；恢复草稿只恢复该草稿自己的元数据。 |
| 首批学习讲解和建议分类未预填 | 按原句及段号共同匹配讲解、分类；缺失分类回退未分类。卡片始终待审，不自动入库。 |
| AI 推荐准备期间仍可确认入库 | 界面禁用与提交函数共同检查忙碌状态；结束后恢复操作，主进程继续保护写入。 |

验证证据位于 `.artifacts/tests/global-knowledge-fixes-20261015/`：

- `source-red.log`、`ui-before.log` 记录修复前失败；`coverage-final.log` 中 5 个文件、50 项定向用例全部通过。
- 两个修复模块覆盖率：语句 95.75%、分支 89.39%、函数 96.52%、行 99.13%，未降低 80% 门槛。
- `hidden-desktop.log` 中 2 项真实 Electron 验证通过；启动目录隔离且窗口保持隐藏，预览及勾审均为零条，确认后才写入。测试临时库已清理，证据保留。
- 类型检查、Lint、生产构建通过；代码审阅未发现本轮高、中风险问题。主责审查技能为 `C:/Users/NO.6/.codex/skills/gstack-review/SKILL.md`。
- `full-unit.json` 记录全量尝试：183 个文件中 157 通过、26 失败；1624 项中 1552 通过、72 失败。失败集中于其他会话、选择器、焦点、错误文案等用例；本次四项定向修复通过不能替代全量发布门禁，未重新打包或宣称发布通过。该轮启动时尚无后来补充的两个生命周期测试文件，它们已纳入上述 50 项定向验证。

修复对重新载入的素材生效，不推测改写历史草稿或正式库中已经保存的错误坐标。测试期间没有把首批待审素材写入用户正式全局库。

## 2026-10-15：其余 72 项失败的根因与修复

原始结果是 26 个测试文件中的 72 个失败用例，不代表 72 个独立产品缺陷。按原报告文件归组如下（合计 72）：

| 用例组 | 原失败数 | 已确认原因与处理 |
| --- | ---: | --- |
| 知识卡、分类、复制和知识范围 | 25 | 自定义 Radix 下拉仍用原生 `change` 操作；未从全局入口切到作品库；菜单及历史折叠后未展开。改用真实键盘和选项交互，保留复制幂等、跨作品隔离和失败草稿校验。 |
| 会话与回答恢复 | 15 | 测试仍要求已取消的“预览发送→确认发送”，并沿用旧按钮和状态文案。对齐直接发送，同时验证停止生成、晚到回复隔离、未知回执核对和未落盘回答保护。 |
| 云服务与拆书命令诊断 | 8 | 网络故障提示已细化，旧精确字符串断言未更新；保留失败不重发、请求范围和发送保护检查。 |
| 写作 AI、伏笔、拆书、书签与手稿 | 16 | 下拉和书签入口已变，伏笔历史改为折叠且原出处分行展示；章节级证据缺少明确粒度说明。同步真实交互，补“章节证据（无段落定位）”说明。 |
| 拆书授权与菜单焦点 | 3 | 实际回归：弹窗优先聚焦了可滚动材料，菜单退出清理又将焦点抢回旧章节。弹窗显式选择输入框或取消按钮，菜单清理尊重已打开的模态框。 |
| 渲染器保护与弹窗退出 | 3 | 旧测试假定关闭同步卸载，或未切到作品知识库。等待真实退出，继续校验焦点归还、数据保存与候选保护。 |
| 安装元数据与教材 | 2 | 锁文件丢失 SQLite 上游 `gypfile: false` 标志；教材新增目录标题导致正文标题统计多算。恢复依赖标志，教材只统计正文区域。 |

此外，补充回归发现 AI 候选待审核期间没有持续报告活动状态，可能恢复灰字提示；现将候选计入暂停条件，不增加全局导航锁。隐藏 Electron 验收还发现退出动画在后台节流时留下原生模态层，后续填写事件被吞掉；隐藏窗口现在同步关闭退出中的弹窗，可见窗口保留动效，快速重新打开仍受代次隔离保护。

本轮未降低覆盖率门槛，未跳过原失败用例，未使用真实用户作品或 API Key。主责代码审查技能为 `C:/Users/NO.6/.codex/skills/gstack-review/SKILL.md`；审阅含补充焦点、候选状态及隐藏退出变更，未发现高、中风险问题。修复原因与取舍已在本节、回归测试和代码注释中保留，不另建重复知识文件。

### 最终验证结果

验证环境：Windows 开发工作区，`soulrain@1.3.4`，后台单 worker。代码修复逐项提交到 `main`。证据目录为 `.artifacts/tests/full-regression-repair-20261015/`。

| 检查 | 最终结果与证据 |
| --- | --- |
| 全量单元及集成测试 | `full-unit-final.json`、`full-coverage-final.log`：185 个文件、1654 项全部通过，零失败、零跳过，退出码 0。原始 72 项失败涉及的全部文件均已通过。 |
| 覆盖率 | 语句 92.49%、分支 87.74%、函数 94.66%、行 97.50%，保持原四项 80% 门槛。 |
| Demo | `demo.log`：74 项通过，使用 `chrome-headless`。 |
| 隐藏 Electron 卷章管理 | `structure-desktop-final.log`：4 项通过，核查创建/排序、章节与整卷恢复、同名作品隔离及重启原稿；开发窗口逐次检查不可见。 |
| 隐藏 Electron 全局知识库 | `hidden-desktop-final.log` 中两项全局用例通过：预览与勾审不入库、逐条审批后落盘、幂等及重启可检索。该日志另有 3 项当时尚未同步的结构测试失败，其后均由上一行的最终结构回归解决，不能把旧日志称为整组通过。 |
| 静态检查与生产构建 | `typecheck-final.log`、`lint-final.log`、`build-final.log` 全部退出码 0；`git diff --check` 通过。 |

中间报告 `full-unit.json` 曾为 1652 通过、1 失败；该次运行与伏笔测试修订重叠，最终以固定代码重新执行的 `full-unit-final.json` 为准。保留中间红绿证据，不覆盖或删除历史失败。

后台 Electron 仅使用隔离的开发入口，临时作品库由测试清理；没有显示或聚焦系统窗口，没有修改用户正式全局库。需要可见窗口的搜索性能、真实云服务、干净 Windows 安装/升级/卸载矩阵本轮未执行；完整发布门禁不因本轮回归通过而自动放行。本轮更新源代码和生产构建，未重新生成 EXE 或安装器。

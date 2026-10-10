# URL 拆文与本机检索实施计划

> **执行智能体：** 按项目 GSD Core 调度，保留 TDD、代码审查和交付验证；采用 executing-plans 顺序集成，可独立文件的研究和测试任务并行。用户提供的 AGENTS.md 已明确默认调度方式，本计划不另换执行方法。

**目标：** 将已确认 Demo 接为真实公开网页导入、可恢复的逐批拆文、本机知识检索及写作参考流程。

**架构：** Electron 主进程冻结来源与授权，数据库 Worker 管理作品资产事务；独立检索 Worker 进行 CPU 嵌入和派生缓存。网页 GET 不读取云凭据，检索不访问网络。先完成网页/来源子项目，再完成模型/检索子项目，最后统一界面与验收；各阶段独立验证，不提前开放未完成入口。

**技术栈：** 现有 React/TypeScript、Electron、SQLite；正文解析候选 @mozilla/readability 与无资源加载 DOM 解析器；本机模型候选 Transformers.js、onnxruntime-node、BGE-small-zh-v1.5。新依赖必须固定版本、通过兼容/许可证核验后才纳入产品。

**规格：** [已确认书面设计](../specs/2026-10-10-url-local-retrieval-design.md)；[界面基准](../../demos/rainsoul-source-intelligence.html)。本计划待作者审阅。

## 全局约束

- Windows 10/11 x64、单机单用户；写作、保存、关键词搜索和导出离线可用。使用既有 Demo logo、白色/天蓝色风格、默认收起侧栏。
- 网页仅 HTTPS/443、无凭据；逐跳校验全部 DNS 地址并固定 IP，最多3次重定向，全程30秒，压缩2MiB/解压5MiB。
- 原文最多200000 Unicode code point/2000非空段，网址2048字符、标题200字符；超限拒绝，不静默截断。
- AI单批最多20段、单次入库最多100条；每批先预览确认，不自动重发，取消与重启不触发联网。
- 作品schema v6与快照payload2独立；读取旧payload1与v4/v5归档，迁移前备份、失败阻止启动。
- 模型512维/512token窗口；文档块400token、重叠50token；查询最多400token并计入前缀/特殊token；CLS池化、L2归一化，RRF k=60。
- 源校验必须覆盖内容hash、未删除状态、作品身份/修订；旧任务、旧查询、旧模型代不能覆盖新状态。
- 模型/向量缓存不进作品归档或日志；模型激活≤512MiB、冷加载≤30秒，受控进程RSS增量峰值≤1.5GiB；超限终止并回退关键词。
- 新核心代码覆盖率各项≥80%；每个独立改动通过相关验证即中文规范提交，超过500行拆分，不提交半成品。

## 审查重点

1. 升级后作者恢复升级前快照：先核对旧hash/旧字段集合，再转换，不能按新表直接拒绝（任务3）。
2. 入库结果未知时重启：使用同一operationId核对回执，不能重复生成条目（任务4）。
3. 选中后切页/模型停用：保留同一作品选择，避免隐藏条目误入云授权（任务8、9）。
4. 已校验来源/索引在异步操作期间变化：提交与发送前重新校验，丢弃过期回执（任务5、7、9）。
5. 本机模型首次加载或损坏：首屏和作者写作持续可用，失败明确回退且不联网补下载（任务6、7）。

## 文件职责与跨任务接口

新文件按职责拆分；不得在 App.tsx 或现有网络传输文件中塞入全部实现。

- `src/shared/source-document.ts`：FrozenSourceDocument/SourceSegment schema与hashVersion=1规范。
- `src/main/public-web-address.ts`、`public-web-transport.ts`、`web-article.ts`：地址校验、受限GET、正文提取；解析不执行脚本。
- `src/workers/database/source-document.ts`：来源/段落/知识关联与学习注释资产；不复用origin_json。
- `src/main/extraction-draft-store.ts`：临时任务与入库回执状态；作者已确认知识以作品库为准。
- `src/shared/retrieval.ts`、`src/main/retrieval-client.ts`、`src/workers/retrieval/`：IPC、Worker生命周期、模型适配、缓存、排序。
- `src/main/retrieval-model-store.ts`、`assets/retrieval-model-manifest.json`：固定清单的下载/离线导入与激活；用户不能提供任意下载地址。
- 拆书、知识、写作、设置组件接上述API；现有保存协调器保留责任。

协议定义在任务1/6冻结；新增跨任务导出名称如下，字段由严格schema验证：

```ts
interface SourceSegment { id: string; ordinal: number; chapterTitle: string; text: string; textHash: string }
interface FrozenSourceDocument {
  id: string; kind: 'txt' | 'docx' | 'web' | 'paste'; hashVersion: 1;
  originalUrl: string | null; finalUrl: string | null; title: string;
  fetchedAt: string | null; rawHash: string; bodyHash: string; segments: SourceSegment[];
}
interface WebImportRequest { workId: string; operationId: string; url: string }
interface RetrievalQuery { workId: string | null; queryId: string; query: string; mode: 'keyword' | 'semantic' | 'hybrid'; categoryId?: string; tagIds: string[]; page: number; pageSize: number }
interface RetrievalHit { workId: string; entryId: string; bodyHash: string; excerpt: string; source: string; matchedBy: ('keyword' | 'semantic')[]; reliable: boolean }
interface RetrievalReply { queryId: string; hits: RetrievalHit[]; total: number; sourceRevisions: Record<string, number>; modelFingerprint: string | null; status: 'ready' | 'fallback' | 'indexing' }
```

FrozenSourceDocument 是新增规范来源对象，嵌入现有 BookExtractionPreview，而非替换已有token/workId；旧文件预览字段保持兼容。

## 子项目A：可信素材与可恢复拆文

### 任务1：公开网页传输与受限正文提取

**文件：** 新建 `src/main/public-web-address.ts`、`public-web-transport.ts`、`web-article.ts`、`src/shared/source-document.ts`；测试 `tests/unit/public-web-transport.test.ts`、`web-article.test.ts`、`source-document.test.ts`；按实现范围拆为独立提交。

**接口：** 在对应文件导出 `PublicWebDependencies`（resolveHost、openRequest、now 可注入）、`SourceInput`（可信来源元信息和原字节/段落）、`KnowledgeSourceLink`、`LearningAnnotation`（后两项由任务3来源schema定义）；`fetchPublicArticle(url: string, signal: AbortSignal, dependencies?: PublicWebDependencies): Promise<{ bytes: Buffer; finalUrl: string; contentType: string }>`；`parseWebArticle(bytes: Buffer, contentType: string, signal: AbortSignal, limits: { deadline: number; maxNodes: number }): Promise<{ title: string; paragraphs: string[] }>`；`freezeSource(input: SourceInput): FrozenSourceDocument`。依赖可注入DNS/HTTPS/时钟，以真实流验证限额。

- [ ] 先写拒绝HTTP、非443、凭据、IPv4/IPv6非公开地址、混合DNS、每跳重绑定的失败测试；写虚假Content-Length、gzip炸弹、DNS超时与即时取消测试。
- [ ] 运行 `npm run test:unit -- tests/unit/public-web-transport.test.ts tests/unit/web-article.test.ts tests/unit/source-document.test.ts`，记录失败点。
- [ ] 实现单一全程deadline，传递AbortSignal到DNS等待/连接/解压；仅GET且不带Cookie/Authorization，TLS原域名验证；流式双限额。下载、解压、独立解析Worker共用deadline和取消控制器；同步解析只位于Worker内部。
- [ ] 使用不加载资源/脚本的解析器；节点/解析时间限额在独立解析执行单元强制终止。覆盖UTF-8/GB18030、脚本/实体/登录页/空正文、解析中取消/超时强制终止/晚回执不替换预览、段落边界和哈希规则，测试通过后类型/Lint/构建。
- [ ] review传输边界；按传输、解析两个可工作单元分别提交 `feat(网页): ...`。

### 任务2：网页/粘贴预览API与取消

**文件：** 修改 `src/shared/book-extraction.ts`、`contracts.ts`、`src/preload/index.ts`、`src/main/book-extraction-commands.ts`、`index.ts`、`p1-command-policy.ts`；新测试 `tests/unit/web-extraction-commands.test.ts`，更新现有preload/commands测试。

**接口：** `fetchWebExtraction(request: WebImportRequest): Promise<BookExtractionPreview>`、`cancelWebExtraction(operationId: string): Promise<void>`、`previewPastedExtraction({workId, text, title}): Promise<BookExtractionPreview>`；只让渲染层提交token/段落ID，来源由主进程冻结。

- [ ] 测试取消不被文件选择队列阻塞，关闭/切作品使晚回执失效，伪造来源/段落拒绝，素材解析脚本不执行。
- [ ] 运行 `npm run test:unit -- tests/unit/web-extraction-commands.test.ts tests/unit/book-extraction-commands.test.ts` 确认Red。
- [ ] 使用任务1函数生成预览并清理超时/取消控制器；保持TXT/DOCX兼容，仅开放固定IPC命令。
- [ ] 同命令Green、类型/Lint/构建；未完成持久来源前只允许预览，不提前启用网页入库。
- [ ] 独立review后提交 `feat(拆书): 添加可信网页与粘贴预览`。

### 任务3：来源资产、学习注释、迁移和历史兼容

**文件：** 新 `src/workers/database/source-document.ts`、`source-schema.ts`、`snapshot-payload.ts`；修改 `schema.ts`、`migration.ts`、`repository.ts`、`book-extraction.ts`、`snapshots.ts`、`archive-project.ts`、`snapshot-export.ts`、`src/main/project-archive.ts`、共享归档/来源schema；测试新增 `source-migration.test.ts`、`source-archive.test.ts` 并更新现有快照/归档测试。

**接口：** `initializeSourceSchema(db)`；`commitSourceAssets(db, source: FrozenSourceDocument, links: KnowledgeSourceLink[], annotations: LearningAnnotation[])`。快照读取 `readCompatiblePayload(db, row): SnapshotPayloadV2`：旧原hash先校验，再按原v4/v5固定表集合校验，内存补空新关系；原历史hash不改。

- [ ] Red覆盖v4/v5升级→旧payload1恢复→新payload2快照→归档→新作品导入；损坏旧hash拒绝且原稿/历史不变。
- [ ] 运行 `npm run test:unit -- tests/unit/source-migration.test.ts tests/unit/source-archive.test.ts tests/unit/snapshot-integration.test.ts tests/unit/archive-project.test.ts`。
- [ ] schema v6备份后事务迁移；学习注释和原著文本分列，source与origin_json分开；来源随复制、恢复与归档映射新ID，跨作品隔离。确保新建和所有旧升级路径均生成v6。
- [ ] 测试注释随资产恢复、会话保持原恢复策略、软删除引用追溯、失败回滚；类型/Lint/构建通过。
- [ ] 拆分迁移、快照兼容、来源归档三个小提交；各自相关验证与review通过才提交。

### 任务4：分批草稿持久化与入库幂等恢复

**文件：** 新 `src/main/extraction-draft-store.ts`、`src/shared/extraction-draft.ts`；修改 `book-extraction-commands.ts`、`book-extraction-ai-commands.ts`、`book-extraction-ai-service.ts`；测试 `tests/unit/extraction-draft-store.test.ts`、`extraction-draft-recovery.test.ts`。

**接口：** 数据库Worker提供受限内部命令 `getBookExtractionReceipt({workId, operationId, requestHash}): Promise<{status: 'missing'} | {status: 'committed'; revision: number; result: WorkDetail}>`，经既有DatabaseClient/StoreService查询，验证作品身份和原请求hash；不向渲染层开放任意operation_log读取。`readExtractionDraft(workId): Promise<ExtractionDraft | null>`、`saveExtractionDraft(request): Promise<ExtractionDraft>`、`discardExtractionDraft(workId, taskId): Promise<void>`；草稿含冻结来源、批次请求hash、候选、审核与committing operationId。沿用现有AI prepare/execute/getResult授权协议。

- [ ] Red覆盖仅部分审核后下一批、取消/断网/重启保留完成候选但不重发、operationId未知回执恢复不重复入库；数据库已提交而草稿更新前崩溃能恢复回执，相同operationId不同hash必须拒绝。
- [ ] 运行 `npm run test:unit -- tests/unit/extraction-draft-store.test.ts tests/unit/extraction-draft-recovery.test.ts`。
- [ ] 原子临时写+rename持久草稿；发送入库前持久冻结请求和operationId；重启先查询原回执；未知结果保持原operationId/hash/完整请求（包括expectedRevision），不得刷新revision改写原请求。已明确未执行的审核候选重新校验原段/分类/标签，新入库操作再取revision，不因前批更新强迫重新联网。
- [ ] 检测磁盘满、坏草稿、无效路径、任务替换及过期回执；Green后类型/Lint/构建。
- [ ] 分草稿存储与审核恢复提交，经review后提交 `feat(拆书): ...`。

### 任务5：正式拆书阅读工作台

**文件：** 修改 `src/renderer/components/book-extraction-workspace.tsx/.css`、`book-extraction-ai-panel.tsx/.css`、`src/renderer/App.tsx`；可新建 `source-reader.tsx`、`extraction-review.tsx` 分担职责；测试现有组件测试及 `tests/desktop/web-extraction.spec.cjs`。

**接口：** 消费任务2/4的预览/恢复API，入库沿用 `onCommitted(work)`；成功提示由App持有，工具保留未处理素材。

- [ ] Red覆盖原文分页20段/页、跨页选段、原文/审核独立滚动、单批最多20段、逐批预览、已入库去重和下批清旧卡。
- [ ] 运行 `npm run test:unit -- tests/unit/book-extraction-workspace.test.tsx tests/unit/book-extraction-ai-panel.test.tsx`。
- [ ] 以确认Demo的双栏布局实现真实网页/文件/粘贴来源和错误取消；阅读分页与AI批次分开，不伪造演示页码或模型状态。只有人工审核才创建知识/注释。
- [ ] 审核期间编辑/删除分类、切作品旧回执、关闭再打开恢复测试；真实Electron受控HTTPS夹具验证，不连接作者素材。
- [ ] 白色/天蓝色、键盘翻页/焦点、720×540滚动截图人工核查，review通过提交。

## 子项目B：本机模型与派生检索

### 任务6：模型资格验证与安装生命周期

**文件：** 新 `assets/retrieval-model-manifest.json`、`src/shared/retrieval.ts`、`src/main/retrieval-model-store.ts`、`src/workers/retrieval/model.ts`、`scripts/qualify-retrieval-model.mjs`；测试 `tests/unit/retrieval-model-store.test.ts`、`tests/unit/retrieval-model.test.ts`。

**接口：** `installRetrievalModel({operationId, source:'download'|'local'}, signal)`；本地包由系统文件选择获得；`getRetrievalStatus(): Promise<RetrievalStatus>`；模型适配 `embed(texts: string[], kind:'query'|'document'): Promise<Float32Array[]>`、`tokenize(text): number[]`。

- [ ] 先写安装取消/失败不替换旧模型、路径穿越/符号链接/未知文件/错误SHA拒绝、运行库隐式联网被阻止的Red。
- [ ] 固定上游修订/运行库版本，下载公开模型许可和tokenizer/ONNX实际文件并计算长度/SHA；资格报告核对分发依据、CLS池化/L2/查询前缀。未通过则记录阻断，不能用随机向量或默认mean替代。
- [ ] 实现固定清单下载与离线包导入、逐文件校验、原子激活；关闭运行库远程模型请求与遥测。清单包含实际大小、许可证、版本、池化/前缀/分块指纹及经独立校准集选择的相似度阈值。
- [ ] `npm run test:unit -- tests/unit/retrieval-model-store.test.ts tests/unit/retrieval-model.test.ts`；真实Windows/Electron CPU离线加载与重复嵌入一致性、512维/有限值/单位范数验证，记录资源预算。
- [ ] 安装存储、CPU适配与清单分独立提交；先通过许可、安全和真实运行门槛才接语义入口。

### 任务7：Worker、分块缓存与混合排序

**文件：** 新 `src/main/retrieval-client.ts`、`src/workers/retrieval/worker.ts`、`cache.ts`、`ranking.ts`、`chunking.ts`；修改数据库知识读取接口和 `scripts/build-desktop.mjs`；测试 `retrieval-ranking.test.ts`、`retrieval-cache.test.ts`、`retrieval-lifecycle.test.ts`。

**接口：** `RetrievalClient.search(request: RetrievalQuery): Promise<RetrievalReply>`、`indexWork(workId): Promise<void>`、`invalidateWork(workId): Promise<void>`、`shutdown(): Promise<void>`；源数据库新增批量 `validateRetrievalHits(workId, [{entryId,bodyHash}])` 返回当前有效内容与revision。

- [ ] Red覆盖400/50分块、余弦条目聚合、RRF k=60、分类子树/标签AND先筛选、稳定排序和跨作品身份去重。
- [ ] 运行 `npm run test:unit -- tests/unit/retrieval-ranking.test.ts tests/unit/retrieval-cache.test.ts tests/unit/retrieval-lifecycle.test.ts`。
- [ ] Float32 SQLite派生缓存以完整指纹/hash/索引代分隔；提交CAS拒绝旧模型任务，检索结果返回前批量源校验；索引低优先级，前台查询优先。编辑/软删/恢复/导入/模型切换立即排除旧项。
- [ ] Green覆盖缓存损坏可重建且不改原库、Worker崩溃/超预算回退、重启断网继续索引、源校验后导航变化丢弃；类型/Lint/构建并验证5秒保存预算。
- [ ] 缓存、排序、Worker接线各自review后提交；不引入额外向量数据库扩展。

### 任务8：知识检索与模型设置界面

**文件：** 修改 `knowledge-workspace.tsx/.css`、`src/renderer/components/settings-page.tsx`、`App.tsx`、`contracts.ts`、`preload/index.ts`、`src/main/index.ts`；新 `src/renderer/components/retrieval-settings.tsx`；测试 `knowledge-retrieval.test.tsx`、`retrieval-settings.test.tsx` 和现有知识组件测试。

**接口：** DesktopApi增加 `searchKnowledgeRetrieval(request)`、模型安装/取消/状态/禁用/重建固定命令，消费任务6/7返回的真实状态；分页3或20条由固定pageSize选择控制，默认20。

- [ ] Red覆盖关键词/语义/混合、缺模型回退、新入库关键词可查、切作品/旧queryId回执不覆盖、空库/无筛选结果/无命中分别提示。
- [ ] 运行 `npm run test:unit -- tests/unit/knowledge-retrieval.test.tsx tests/unit/retrieval-settings.test.tsx tests/unit/knowledge-workspace.test.tsx`。
- [ ] 按Demo显示两行正文摘要、原位展开、右下出处、结果分页与参考选择；真实模型状态、下载许可/大小/费用范围分别说明。跨作品只读，复制后选用；最多5条。
- [ ] 键盘/屏幕阅读器标签、分页末页删除与零结果、下载取消/磁盘满/索引损坏重试和窄窗滚动测试；Green后类型/Lint/构建。
- [ ] 拆为模型设置、知识检索接线两个review与提交。

### 任务9：写作参考、差异对比与状态保护

**文件：** 修改 `src/renderer/components/ai-workspace.tsx/.css`、`src/shared/ai-reference.ts`、`src/main/ai-commands.ts`、`App.tsx`；新 `src/shared/text-diff.ts`；测试 `text-diff.test.ts`、`ai-reference.test.ts`、`ai-workspace.test.tsx`、`renderer-ai.test.tsx`。

**接口：** 知识卡选用保存在作品级状态；AIprepare接entryId列表，主进程重新校验并冻结完整正文/来源；候选包含生成时目标范围/基线，复用现有确认和保护快照。

- [ ] Red覆盖语义命中不被旧关键词前五条再次过滤、跨页参考保留、移除不发送、跨作品必须复制、选中后条目修改/删除重新预览。
- [ ] 运行 `npm run test:unit -- tests/unit/text-diff.test.ts tests/unit/ai-reference.test.ts tests/unit/ai-workspace.test.tsx`。
- [ ] 单句/段落/续写分别明确目标；可访问的增删差异高亮、保留原文；离开核对知识后候选仍在，换作品严格隔离，正文变化禁用旧候选。
- [ ] 确认授权前再次验证版本与引用，网络等待期源变化不得静默换材料；取消/失败不自动重发、写入前快照失败不改正文，类型/Lint/构建通过。
- [ ] 差异算法与作品级参考接线分别独立review/提交。

## 子项目C：交付证据与教材

### 任务10：质量评估、真实包与团队任务验收

**文件：** 新 `tests/fixtures/retrieval-corpus.json`、`retrieval-calibration.json`、`scripts/evaluate-retrieval.mjs`、`tests/desktop/retrieval.spec.cjs`、`retrieval-performance.spec.cjs`；修改 `vitest.config.mts`、`scripts/pack-desktop.mjs`、`scripts/third-party-notices.mjs`、发布门禁记录；新 `tasks/url-local-retrieval-acceptance.md`。

- [ ] 独立人工标注100条中文知识与30条验收查询，另设阈值校准集；15条语义改写、5条无相关项。测试正确标签/来源，不用随机向量证明检索质量。
- [ ] 用真实模型评估改写组混合Recall@5≥0.8且不低于关键词，5条无相关查询可靠推荐误报≤1条；原始结果和失败例保存。未达标先优化，不降低门槛。
- [ ] 新安装包含正确原生库/Worker/许可；真实包离线启动、冷加载≤30秒、千条知识200样本混合P95≤1秒，模型运行RSS增量≤1.5GiB、并发索引下5秒落盘。
- [ ] `npm run verify`、`npm run pack:installer`；团队执行规格七条任务并记录步骤/耗时/错误/截图；独立网络安全、代码与视觉审查。原型验证不替代真实包验证。
- [ ] 真实云与干净Windows矩阵仍分别登记外部门禁；缺环境不虚报通过。通过的测试/打包改动分小commit，未满足门槛不标最终发布。

### 任务11：项目教材与基线文档同步

**文件：** `learning/项目全流程开发学习/` 新增卷章、课程清单与真实截图；修改现有PRD/技术方案/立项V2.0/发布记录，仅更新相应状态，不另建重复立项。

- [ ] 先核验已完成源码与验收记录，区分已实现、已验收和外部待验。
- [ ] 教材按技术原理→项目具体源码→跟做→排错→拓展练习编写HTTP/SSRF、提取、token/嵌入、RRF、缓存一致性、Worker/TDD章节；代码与图只取真实实现。
- [ ] `npm run test:unit -- tests/unit/learning-course-builder.test.ts tests/unit/learning-seed.test.ts`；确保更新保留作者改过的学习正文；`npm run build`验证课程可编译。
- [ ] 文档链接/命令/源码行号人工核对；记录独立review发现与复利经验。
- [ ] 中文文档commit，说明文档变更测试范围。

## 执行顺序与门槛

1→2→3→4→5 是可信来源闭环；6→7→8 是本机检索闭环；9依赖5/8，10依赖所有产品任务，11随各功能更新并最终核对。任务1安全网络研究与任务6公开模型资格研究可并行，但产品文件集成按前述顺序。每个任务内部依Red→Green→重构→review→提交执行，拆分提交不得留可触发的半成功流程。

开始正式产品改动前，作者审阅本计划；执行方法沿用项目GSD Core。模型/发布环境确实不可用时保留未满足证据，报告具体阻断，继续与之独立的已批准任务；不把模型替身当真实验收。

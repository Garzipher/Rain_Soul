# P1 增量独立复审

评审日期：2026-10-09。评审基线：`8ad1c46`，重点复核 `9577aa7`、`233307c` 和此前会话恢复修复。此报告由独立评审 agent 根据实际源码与专项测试编写。

结论：本次评审范围内没有未解决的发布阻断。会话此前发现的四类失败恢复问题均已消除；拆书选择期间的离开保护、可信文件定位与批量审核事务未发现新增回归。全项目发布状态仍以主流程完整验证和发布门禁报告为准。

## 会话恢复与权限

- `src/main/conversation-ai-commands.ts`：完整云回答返回后先缓存冻结请求和回答，再执行后验校验；会话、配置变化或读取失败返回待恢复错误，保留已完成回答。`activeHashes` 覆盖执行至 `finally`，进行中的核对、重试、放弃统一返回 `CONVERSATION_IN_PROGRESS`。
- `src/renderer/components/conversation-workspace.tsx`：执行回执出现任何异常都按原 `requestHash` 锁住并提供本机核对。删除已完成后的列表读取错误单独保留刷新入口，不误判为写失败，也不重放删除。
- `src/renderer/components/conversation-reply-recovery.tsx`：只有明确 `NOT_FOUND` 且重新读取当前会话成功才解除未知结果保护；放弃先成功读取，再删除暂存回答；保存重试复用原请求，只调用本机数据库。
- `src/main/p1-command-policy.ts`、`src/main/store-service.ts`：公开 IPC 拦截私有双消息和拆书提交命令；公开消息仅允许作者角色，禁止伪造模型回执。会话和拆书存储命令限定当前作品。
- `src/workers/database/conversations.ts`：双消息、草稿清空、修订号和操作回执同一事务提交；修订与发送草稿双重校验，重放不重复插入。分页游标必须属于当前会话。
- `src/renderer/App.tsx`、`src/renderer/hooks/use-writing-session.ts`：同步脏状态参与导航与关闭检查，待保存回答、草稿、授权和进行中操作不会静默离开。原生模态焦点与忙时取消保护接线已复核。

## 拆书与长出处界面

- `src/renderer/components/book-extraction-workspace.tsx:26` 在文件选择异步调用前同步通知父级脏状态；保护条件包含 `preview !== null || busy`。文件选择取消完成后解除保护，解析或提交失败保留可操作界面及已有审核内容。
- 默认不勾选段落；修改摘选正文、分类或标签会撤销该段审核。权限确认、有效来源名和 1 至 100 条已审核内容共同决定能否提交。
- 退出已有预览须确认；取消失败保留预览与审核。相同提交内容的失败重试复用 `operationId`，不重复入库。
- `src/renderer/components/knowledge-workspace.css` 允许出处与操作区换行，操作区不缩小、按钮文字不折行，出处允许长 SHA 文本换行。卡片仍原位展开正文并完整保留出处。

## 来源与原子审核边界

- `src/main/book-extraction-commands.ts` 仅解析系统文件选择返回的 TXT/DOCX 字节；主进程冻结段落与文件摘要并返回副本。确认协议严格校验，不能提交任意路径、伪造文件摘要或自行提供出处字段。
- 提交的 `segmentId` 必须属于当前预览，且不能重复；取消或更换文件使旧预览失效。出处中的文件名、章段定位、文件 SHA-256 和原段落 SHA-256 均由冻结文件构造。作品名和作者是作者维护的来源说明，摘要提供内容定位，不能证明作品版权或作者身份。
- `src/workers/database/book-extraction.ts` 先检查作品身份、删除状态、回执与修订；安全快照、知识条目、标签关联、历史、搜索更新、作品修订和回执共同处于即时事务。分类或标签错误、跨作品、版本冲突及半批失败全部回滚。
- 主进程队列串行处理选择、确认和取消；失败保留冻结预览供同请求重试，成功回执不会重复创建条目。

## Schema 5 与旧归档

- `src/workers/database/migration.ts` 在迁移前使用 `VACUUM INTO` 获取包括已提交 WAL 的备份，并验证备份可读和完整性。新增会话表、完整性/外键检查和版本更新在同一事务中执行；失败保留原库和备份，未成功备份不修改原库。
- `src/workers/database/archive-project.ts` 校验清单版本、数据库摘要、大小、实际 `user_version` 和可信参考 schema；源库只读且关闭可信 schema，拒绝未知表、触发器、视图及不匹配结构。
- V4 归档不含会话，导入到全新 V5 目标库并保留原项目；V5 会话及消息经过字段、角色、日期、摘要、外键和排序验证。会话操作回执不进入便携归档，会话也不进入正文快照。
- 导入在独立暂存库事务重建，完成完整性验证后再移动到新作品目录；失败清理暂存目录，不覆盖现有作品。

## 独立验证证据

1. 会话复核命令：`npx vitest run tests/unit/conversation-workspace.test.tsx tests/unit/conversation-reply-recovery.test.tsx tests/unit/conversation-ai-commands.test.ts tests/unit/p1-command-policy.test.ts tests/unit/renderer-conversations.test.tsx --pool=threads --maxWorkers=1`。20:49 执行，5 个文件、35 项全部通过，退出码 0。
2. 增量复核命令：`npx vitest run tests/unit/book-extraction-workspace.test.tsx tests/unit/book-extraction-commands.test.ts tests/unit/book-extraction-database.test.ts tests/unit/knowledge-long-source.test.tsx tests/unit/conversations-migration.test.ts tests/unit/conversations-archive.test.ts tests/unit/archive-project.test.ts tests/unit/migration.test.ts tests/unit/assets-migration.test.ts --pool=threads --maxWorkers=1`。20:58 执行，9 个文件、52 项全部通过，退出码 0。

本次未重复运行全项目类型检查、Lint、生产构建或桌面全套，也未执行真实云与干净 Windows 安装、升级、卸载矩阵。长出处的真实窗口尺寸测试位于 `tests/desktop/p1-workflow.spec.cjs`，此次独立评审读取了用例，未单独重跑该桌面用例；不把组件/CSS回归等同于桌面视觉验收。此文档新增不改变运行行为，无需新增行为测试。

# 第三章 数据库单写者与失败传播

本章状态：数据库 Worker、请求关联和失联保护已实现；文件任务 Worker 属于后续方案。

better-sqlite3 使用同步调用，适合直接表达事务，但在主进程执行大型查询可能冻结窗口。当前把它放进数据库 Worker，由一个写者串行处理作品操作。主进程负责权限和生命周期，Worker负责持有连接和执行仓储。这样同步 SQL 不会直接占住界面线程。

`DatabaseClient` 为每次往返生成 requestId，存入 pending Map；Worker 回传相同 ID 后，主进程 resolve 或 reject 对应 Promise。收到无对应请求的消息不会随便更新界面。Worker 出错或退出时，所有等待中的请求失败，之后请求也被拒绝，不能静默重启并重放写命令。

失联为什么不能直接重发？假设 Worker 已把“新增章节”提交，回执尚未到达就退出。新 Worker 若用一个新 operationId 新增，会产生重复章。运输失败没有证明业务未发生，因此重试要使用仓储记录的原 operationId，且由作者明确发起。

简化示例：

```text
requestId A → operationId X → SQLite提交
回执A丢失
requestId B → operationId X → 查operation_log并取回结果
```

实践步骤：在 `src/main/database-client.ts` 找 pending Map 和 fail；在 `src/workers/database/worker.ts` 找命令 switch；在仓储找 operation_log。分清“匹配 Promise”和“避免重复写入”分别在哪一层完成。

关闭时主进程先等待 StoreService drain，确认已排队写入结束，再允许关窗。它不是断电保护，系统强制结束仍可能丢掉未提交草稿。SQLite 的事务和 FULL 同步负责已提交数据的持久性，不能替界面保存尚未发出的内容。

证据：`tests/unit/database-worker.test.ts`、`database-structure-worker.test.ts` 使用真实编译 Worker；第二批链路验证新增卷章、保存、删卷恢复、删作品恢复后正文仍在。构建脚本是测试前置条件，不能让测试运行上一版 Worker。

练习：写一个时间序列，包含 Worker 提交、界面继续输入、回执迟到和关闭请求。指出哪几步可以并行，哪几步必须按顺序等待。

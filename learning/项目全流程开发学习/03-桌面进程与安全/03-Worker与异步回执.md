# 第三章 Worker 与异步回执

本章状态：数据库Worker、请求关联、错误传播和真实持久化测试已实现。
本章关注传输结果，业务幂等与失败草稿将在第五卷深入。
不要把异常消息自动归因于“SQLite损坏”。

## 学习目标与前置知识

知道 `Promise` 可以成功或失败。
理解 IPC命令会通过主服务到达数据库层。
将学会区分阻塞、传输身份、业务身份和未知回执。
实验使用临时目录，不访问“雨落之后”的真实数据目录。

## 技术基础：事件循环与请求关联

### 同步工作为何会阻塞

一个 JavaScript 线程一次执行一段任务。同步 SQL 尚未返回时，同线程不能继续处理下一段 JavaScript。把函数声明成 `async` 也不会自动把同步 SQL 搬到别的线程；真正的隔离需要 Worker。

项目创建 `new Worker(...database-worker.cjs)`，主进程发送消息后马上返回一个待完成的 Promise。Worker 执行 SQLite，再回传结果。因此“数据库代码是同步的”与“界面等待是异步的”可以同时成立。

### 为什么要有 pending Map

假设同时等待 A、B 两次查询，只靠“收到一个结果就给第一个调用”容易串结果。Map 保存 `requestId → resolve/reject`，Worker 回传同一个 ID，主进程就能找到准确的等待者。

```text
发送 A：pending[A] = A 的等待者
发送 B：pending[B] = B 的等待者
收到 B 回执：解决 pending[B]，删除 B
收到 A 回执：解决 pending[A]，删除 A
```

本项目通常通过上层队列串行业务，但传输层仍必须使用关联 ID。否则未来读操作或错误事件一旦重叠，就可能错误地接受另一请求的结果。

### 回执与提交不是一件事

“回执”是接收方告知结果的消息，提交是 SQLite 将事务完成。两者之间有时间间隔。一个异常可能发生在提交之后、回执之前；调用方不能因为没收到成功就断定没有写入。

所以 Worker 的错误传播负责结束等待，业务幂等日志负责确定是否已经提交。前者解决卡住，后者解决重复写入。第五卷会用一条保存时间线把二者组合起来。

## 1. 为什么不在窗口线程直接写库

better-sqlite3提供同步数据库调用。
同步调用便于事务编写，但长查询或写入会占用执行它的线程。
如果它直接占据界面线程，作者可能看到输入与点击停顿。

本项目把数据库放在Node Worker中。
主进程通过消息发送任务，Worker顺序执行同步仓储调用，再回传结果。
React保持自己的界面事件循环。
这不是无限并行数据库，而是把重活放到明确的执行边界。

## 2. 观察Worker入口

```powershell
Set-Location E:\soulrain
Get-Content .\src\workers\database\worker.ts
```

启动时先读取包内课程、保证默认学习作品，然后创建仓储。
收到命令后按switch白名单调用指定方法。
出错会返回 `{ ok: false, message }`，不会把连接对象发给页面。

Worker本身不展示弹窗，也不修改React状态。
它只承担本地数据工作和回执。
UI如何解释失败，由上层保存状态与操作门禁决定。

## 3. 看懂一次传输的结构

```ts
interface WorkerRequest {
  requestId: string;
  command: string;
  payload: unknown;
}

interface WorkerReply {
  requestId: string;
  ok: boolean;
  data?: unknown;
  message?: string;
}
```

这是用于讲解的完整最小传输形状。
真实项目在database-client与worker中分别声明相应对象。
`requestId`让调用方找到等待这次结果的Promise。
它不等同于保存正文的 `operationId`。

## 4. 两种ID分别解决什么问题

假设“雨落之后”一次保存已经提交，但回执未到页面。
作者点击重试，传输层需要一个新的 `requestId` 关联新一趟消息。
业务层仍需原来的 `operationId`，才能取回原保存结果。

| ID | 识别什么 | 重试时是否应变化 |
| --- | --- | --- |
| requestId | 一次进程消息往返 | 新传输通常新ID |
| operationId | 一次确定的业务修改 | 原请求重取应保持 |
| chapterId | 被修改的章节 | 不因保存而变化 |
| paragraphId | 章节中的段落 | 普通文字修改不变化 |

ID多不是为了复杂，而是不同对象具有不同生命周期。
用一个随机ID承担所有责任，会让重试、定位与更新混淆。

## 5. 运行真实Worker测试

```powershell
npm run test:unit -- tests/unit/database-worker.test.ts
```

`pretest:unit`先编译桌面入口，所以测试读取最新Worker产物。
预期未知命令被拒绝后，合法创建与保存仍成功。
测试在系统临时目录建库，结束时终止Worker并删除自己创建的样本。
它不会需要你先在作品集里建立同名作品。

```powershell
Get-Content .\tests\unit\database-worker.test.ts
```

沿着 `new Worker`、`postMessage`、`requestId`筛选和 `openWork`阅读。
测试保存两个汉字“落盘”，期待新版本为2、字数为2。
重新打开后核对文档对象，是对真实持久化的进一步检查。
仅断言 `postMessage` 被调用，并不能证明数据库更新成功。

## 6. 一个请求为什么可能永久等待

DatabaseClient把等待者保存到 `pending` Map。
回执到达后删除对应项，并解决Promise。
如果Worker启动失败或退出，所有等待者都应收到失败。
否则作者可能一直看到保存中，也无法安全关闭。

```powershell
Get-Content .\src\main\database-client.ts
```

查 `worker.on('error')`、`worker.on('exit')` 和 `fail`。
`fail`记录服务失败、拒绝等待者、清空Map。
后续请求也直接失败，不再投递到已死亡的Worker。
这是故障传播，不是数据库自动恢复。
页面仍须保留草稿并告诉作者如何处理。

## 7. 消息回执丢失意味着什么

一条失败消息不能单独证明数据库没有写入。
数据库可能完成事务，然后在回传时出现错误。
因此业务仓储需要保存操作日志并支持同请求重放。
第五卷会把这件事与CAS版本检查组合起来。

本章只要求你能说出三个状态：
请求尚未发送、请求可能已提交、结果已确认。
不同状态的重试策略不同。
例如空标题在主服务校验前失败，和事务成功后丢回执不能同样处理。

## 8. 做一次不破坏稿件的排错记录

如果Worker测试失败，记录第一条异常、Node版本与构建结果。
检查 `dist/desktop/database-worker.cjs` 是否存在。
然后查课程JSON与原生模块是否能够被加载。
不要直接删作者的 `Projects` 目录试图让测试变绿。
测试样本与真实数据必须隔离。

## 常见问题与排查

| 现象 | 先检查 | 下一步 |
| --- | --- | --- |
| Worker找不到 | 桌面产物是否存在 | 先构建再运行 |
| 启动立即失败 | 课程资源、原生模块 | 保留具体异常并检查环境 |
| 回执串到另一请求 | requestId匹配 | 检查pending关联 |
| 保存一直等待 | Worker退出/错误传播 | 确认等待者被拒绝 |
| 重试产生重复内容 | operationId生命周期 | 进入第五卷幂等检查 |

## 本章验收与练习

验收：能解释同步数据库为何放到Worker。
验收：能区分requestId与operationId。
验收：能指出Worker停止后等待中的请求应怎样结束。

练习1：Worker测试通过，能证明输入法不会丢字吗？
参考：不能。输入法与界面焦点需要组件和桌面场景检查。

练习2：为何测试先发送未知命令，再发送合法命令？
参考：同时检查拒绝边界与失败后继续服务的能力。

练习3：画出“事务成功，回执丢失”的时序。
提示：用两条竖线分别表示仓储与调用方，把提交点与接收点分开。

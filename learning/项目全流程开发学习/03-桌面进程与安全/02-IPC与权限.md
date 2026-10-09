# 第二章 IPC 与权限

本章状态：预加载窄 API、命令校验、当前作品写权限与串行执行已实现。
本章使用保存“雨落之后”的章节来说明跨进程通信。
请在独立练习或测试中构造非法请求，不拿自己的稿件做破坏性实验。

## 学习目标与前置知识

知道主进程与渲染进程不能直接共享一个数据库连接。
知道 JSON 数据可以在边界上传输。
将认识 IPC、运行时校验、当前作品权限与队列。
本章不需要安装任何新库，项目已有 Zod 与 Vitest。

## 1. IPC 是对话，不是万能通道

IPC意为进程间通信。
渲染器说“保存这一章”，主进程检查请求，再决定是否送给Worker。
它不应该说“执行我提供的这段SQL”。

这一区别很关键。
明确动作可以校验作品ID、章节ID、标题和正文结构。
任意SQL则可能绕过当前作品限制，甚至删除整个库。
窄API让可做的事被清楚列举，也让测试能够覆盖每条入口。

## 2. 读取预加载层

```powershell
Set-Location E:\soulrain
Get-Content .\src\preload\index.ts
```

下面是保存桥接的真实结构，阅读即可，不覆盖文件：

```ts
saveChapter: (
  workId, chapterId, title, document,
  expectedRevision, operationId,
) => invoke('saveChapter', {
  workId, chapterId, title, document,
  expectedRevision, operationId,
}),
```

页面拿到的是 `window.rainSoul` 的限定方法。
它没有拿到完整 `ipcRenderer`，也不能任意选取系统路径。
方法名、参数和结果都对应 shared契约。
新增功能时要扩充明确命令，而不是暴露一个通用执行器。

## 3. TypeScript与Zod为何同时存在

TypeScript在开发期检查源码关系。
Zod在运行期检查真正传进来的值。
即使声明 `title: string`，实际页面仍可能发送空串或额外字段。

```powershell
Select-String -Path .\src\main\store-service.ts `
  -Pattern 'strict|schemas|parse' -Context 0,2
```

服务为每个命令定义schema，并使用 `.strict()` 拒绝未知字段。
保存正文则复用受限文档schema。
例如附带 `path: 'C:\\...'` 的创建请求，不应被悄悄接受。
拒绝未知字段让安全边界不会因未来某段代码误用额外数据而变松。

## 4. 当前作品权限与有效ID是两回事

一个UUID格式正确，不代表调用者有权修改该作品。
服务记录 `activeWork`，明确打开或创建成功后才切换权限。
打开失败不能让旧作品突然失去合法写入状态。

```powershell
Select-String -Path .\src\main\store-service.ts `
  -Pattern 'activeWork|当前作品|openWork' -Context 0,2
```

正常路径是：打开“雨落之后” → 修改该作品章节。
非法路径是：没有打开作品，直接发送其保存请求。
另一个非法路径是：已经切到另一作品，旧请求仍试图写旧作品。

恢复已删除作品是明确的全局操作例外。
例外应由动作类型与测试限定，不能简单把权限检查全部关闭。
删除操作还需处理回执重放，否则丢失回执后无法安全确认原结果。

## 5. 运行已有权限测试

```powershell
npm run test:unit -- tests/unit/store-service.test.ts
```

预期正常结束，未知命令、路径伪装和当前作品限制都有检查。

```powershell
Get-Content .\tests\unit\store-service.test.ts
```

找到“不发送到Worker”的断言。
测试不仅要求出错，还要求危险请求根本没有越过本层。
错误提示正确但底层已经写了数据，仍是失败实现。

## 6. 阅读一段完整的最小权限实验

下面是独立测试的完整示例，不要替换项目原有测试。
可以在个人练习分支中增加临时测试，并运行后移除或规范提交。

```ts
import { expect, it } from 'vitest';
import { StoreService } from '../../src/main/store-service';

it('空标题不会进入真实传输', async () => {
  let calls = 0;
  const service = new StoreService(async () => {
    calls++;
    return {};
  });
  await expect(service.execute('createWork', {
    title: '   ',
  })).rejects.toThrow();
  expect(calls).toBe(0);
});
```

示例文件若放在 `tests/unit/`，相对导入才能与这里一致。
先理解目录关系，再复制代码。
这个测试检验运行时边界，不触及真实作品数据库。

## 7. 为什么主服务要串行执行

请求可能在很短时间内连续到达。
如果“打开作品”和“保存章节”乱序执行，activeWork可能不符合作者动作。
服务以Promise链排队，让前一操作结束后再处理下一操作。
失败会被队列内部消化为继续排队的状态，但当前调用仍收到错误。

```powershell
Select-String -Path .\src\main\store-service.ts `
  -Pattern 'queue|drain' -Context 0,2
```

`drain` 等待已排队操作结束，用于安全关闭。
串行队列降低顺序复杂度，但事务与业务幂等仍要保留。
一个机制不能替代另一个不同责任的机制。

## 常见问题与排查

| 现象 | 检查 | 处理 |
| --- | --- | --- |
| 当前作品写入被拒绝 | 是否明确打开成功 | 修复调用顺序而非删权限检查 |
| 多了一个字段就失败 | strict schema | 使用约定参数 |
| 页面类型正确仍报错 | 运行期真实payload | 查空值、UUID和正文结构 |
| 一个失败让后续全卡住 | 队列错误恢复 | 检查queue续接与请求错误返回 |

## 验收、练习与提示

验收：能说明格式合法与权限合法不同。
验收：能找出校验前后请求是否进入Worker的证据。

练习1：能否给API增加 `executeSQL(sql)` 方便开发？
参考：不应。它绕过白名单、权限和业务事务边界。

练习2：一个未知命令被拒绝，后续合法请求应怎样？
参考：仍能正常执行，单次失败不应使整个队列永久失败。

练习3：为什么只检查 event.sender 还不够？
提示：主入口还检查senderFrame是否为主frame，避免未知子frame借同窗口身份调用。

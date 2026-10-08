# 第二章 类型化 IPC 之后，还要校验与授权

本章状态：当前作品写权限、Zod 白名单和结构命令校验已实现。

预加载层的 `DesktopApi` 是前后端对接合同。例如 `saveChapter` 接收作品、章节、标题、文档、expectedRevision 和 operationId。TypeScript保证正常代码按契约调用，但 IPC 边界收到的仍可能是不合法运行时值。因此 StoreService 先识别已知命令，再使用 strict schema 校验，拒绝多余字段、非法 UUID、空标题和未知动作。

“参数合法”和“有权限写这个作品”是两件事。当前一次只编辑一个作品，StoreService 记录 activeWork。打开或创建作品成功后设置它；写入请求必须指向该作品。恢复已删除作品是明确例外，因为作品集里已经看不到它；不能借这个例外允许所有跨作品写入。

结构删除还有回执重放问题：删除作品成功后 activeWork 被撤销，若回执丢失，作者仍要重取同一删除结果。服务层只保留完全相同请求的例外，而不是允许任何新的 deleteWork。作品恢复后重取旧回执，也不能把当前权限重新清掉。

实践步骤：

1. 阅读 `src/shared/structure-schema.ts` 的动作联合类型：每种动作只允许自己的参数。
2. 在 `src/main/store-service.ts` 找 `Object.hasOwn` 和 `parse`。
3. 跟踪 activeWork 何时变化，注意失败不能先撤权限。
4. 阅读队列：一次命令失败后，用 catch 接住队列链，后续合法命令仍有机会执行。

示例：`{type:'deleteChapter', chapterId, unexpectedPath:'C:/...'}` 必须被拒绝，不能把未声明字段默默转给 Worker。UUID 校验减少路径滥用，当前目录仍由仓储固定拼接，界面没有指定任意数据库路径的能力。

证据：`tests/unit/store-service.test.ts` 覆盖未知命令、非法参数、非当前作品写入、失败不撤权限、删除后同请求重放和恢复后旧删除回执。第二批时服务测试为 8 项；数字描述当时基线，不代表今后永不变化。

练习：设计 `exportWork` 的权限检查，分别判断“读取当前保存版本”“写作者选择的输出位置”和“发送云端”需要什么不同授权。先写规则，未来实现时再写严格命令。

# 第二章 严格类型、依赖锁和可重复构建

本章状态：当前工程已配置 TypeScript、ESLint、Vitest、Vite 和 Electron 构建。学习目标是理解这些工具分别防什么问题。

TypeScript 检查编译期契约，例如 `Chapter.volumeId` 允许 UUID 或 null，提醒调用者处理无卷章节；ESLint发现静态规则问题；Vitest验证行为；Vite打包渲染页面；构建脚本生成主进程、预加载层和 Worker。工具之间没有替代关系，类型正确也可能把删除目标写错。

先阅读 `src/shared/contracts.ts`：`DesktopApi` 定义界面能够调用什么，`WorkDetail` 包含作品版本、卷、章和已删除条目。调用链共同使用契约，修改字段时编译器能暴露漏接点。但来自 IPC 的值仍是运行时输入，所以还必须用 Zod 校验，不能只写一个 `as` 断言就信任外部对象。

当前验证组合锁定 Electron 44.7.0、Tiptap 3.31.4、better-sqlite3 13.0.3。`package-lock.json` 锁定传递依赖，不能因为某个库发布新版就随意改变。原生驱动尤其要重新检查 Node-API、Windows 架构、Worker 和目录包是否兼容。

可执行步骤：

1. `npm install` 安装锁定依赖，阅读安装结果而不是只看目录出现。
2. `npm run typecheck` 检查类型，`npm run lint` 检查静态规则。
3. `npm run build` 同时生成渲染资源和桌面代码。
4. `npm start` 自动构建再运行 Electron，避免运行旧 dist。
5. 修改 Worker 后确认测试前置构建。曾经测试碰到旧数据库结构，根因是编译产物过时，不能误判成新功能失败。

学习示例：新增 `volumeId` 后，旧测试适配器也必须返回它。补齐契约能修复编译，但仍要验证移卷后正文归属不丢；否则只完成了“形状正确”。

阅读对接：`package.json`、`tsconfig.json`、`vite.config.mts`、`scripts/build-desktop.mjs`；提交 `b7fa40e` 锁依赖，`44a098e` 配质量工具。两批执行记录包含实际通过结果。

练习：临时在独立分支把 `volumeId` 改成必填字符串，观察哪些无卷调用报错，再还原。不要提交故意破坏的实验，把学习结论记在自己的章节中。

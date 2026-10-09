# 第二章 TypeScript 与构建

本章状态：项目已有类型检查、Vite 前端构建与 esbuild 桌面构建。
你将从文件产物理解“源码如何变成 EXE 中运行的内容”。
本章不改业务逻辑，只运行与观察现有构建。

## 学习目标与前置知识

已完成上一章环境检查。
知道终端当前目录会影响相对路径。
知道浏览器与 Node 拥有不同的运行能力。
本章会出现接口、模块与构建三个概念，不要求先精通编译原理。

## 1. 类型检查不是生成程序

TypeScript 接口描述数据形状，例如一章拥有标题与正文。
它可以提前发现把数字传给标题参数等错误。
但接口在运行时不会自动替你检查恶意请求，也不会自动产生界面。

本项目 `tsconfig.json` 设置 `noEmit: true`。
因此 `tsc --noEmit` 的职责是检查，不是输出可运行文件。
真正输出分别由 Vite 和 esbuild 完成。

```powershell
Set-Location E:\soulrain
Get-Content .\tsconfig.json
npm run typecheck
```

预期看到 `strict: true` 与 `noEmit: true`，检查正常结束。
严格模式让潜在空值等问题更早出现，不应为省事关闭。

## 2. 用一个接口读懂数据约定

从真实 `contracts.ts` 摘出最小部分：

```ts
export interface TextNode {
  type: 'text';
  text: string;
}

export interface ParagraphNode {
  type: 'paragraph';
  attrs: { id: string };
  content?: TextNode[];
}
```

这里为了讲解省略了项目还支持的 `hardBreak`，不要覆盖原文件。
`type` 是字面量，帮助区分不同节点。
`content?` 表示属性可以不存在，并不表示正文一定为空字符串。
`id` 用来稳定识别段落，不是第几段的展示编号。
第四卷会使用完整项目契约做运行时实践。

检查真实定义：

```powershell
Get-Content .\src\shared\contracts.ts -TotalCount 30
```

比较教材摘录与真实文件，是学习“简化示例”与“完整实现”的必要习惯。

## 3. 观察一次完整构建

确保当前没有桌面测试在跑，再执行：

```powershell
npm run build
Get-ChildItem .\dist
Get-ChildItem .\dist\desktop
Get-ChildItem .\dist\renderer
```

预期 `dist` 至少包含 `desktop` 与 `renderer`。
桌面目录中有 `main.cjs`、`preload.cjs` 和 `database-worker.cjs`。
前端目录中有 `index.html` 与带构建哈希的静态资源。
资源哈希可以改变，所以不要在教程中硬编码某个 bundle 文件名。

构建输出是可以重新生成的产物，真源仍在 `src` 与 `learning`。
不要为了临时修一行界面直接编辑 `dist`。
下次构建会覆盖修改，而且 Git 无法追踪正确的源码原因。

## 4. 两条构建路径各做什么

```text
React / CSS / HTML
  → Vite
  → dist/renderer

main / preload / database-worker
  → esbuild
  → dist/desktop/*.cjs
```

Vite 以渲染器目录为前端入口，处理 React 和浏览器资源。
esbuild 将桌面入口打包为 CommonJS，方便 Electron 与 Worker 加载。
原生 SQLite 模块不能当普通浏览器 JavaScript 打包。
所以构建配置把 `better-sqlite3` 留作外部运行依赖。

```powershell
Get-Content .\vite.config.mts
Get-Content .\scripts\build-desktop.mjs
```

在后者中找 `external` 与三个入口。
然后找课程编译和 Logo 复制步骤。
它们提醒我们：可运行产物不仅是代码，也包含离线教材与图标资源。
新增静态资源时，构建与打包都必须纳入验证。

## 5. 从 package.json 追踪一个命令

```powershell
node -e "const p=require('./package.json'); console.log(p.scripts.build); console.log(p.scripts.pack); console.log(p.main)"
```

`build` 先构建前端，再构建桌面部分。
`pack` 先完成构建，再运行目录包包装脚本。
`main` 指向 Electron 启动的桌面主入口。
这解释了为什么直接打开 `src/renderer/index.html` 不能替代应用启动。
它没有完成构建，也没有得到预加载层提供的 API。

## 6. 检查产物，而不是仅看绿色文字

```powershell
$required = @(
  '.\dist\desktop\main.cjs',
  '.\dist\desktop\preload.cjs',
  '.\dist\desktop\database-worker.cjs',
  '.\dist\desktop\learning-course.json',
  '.\dist\renderer\index.html'
)
$required | ForEach-Object {
  [pscustomobject]@{ 文件 = $_; 存在 = Test-Path $_ }
}
```

预期每项“存在”为 True。
文件存在只是基础检查；仍需启动程序证明它们能协同工作。
打包后还要从 `release/win-unpacked` 运行真实 EXE。
不能以开发运行正常推断目录包一定包含了全部资源。

## 常见问题与排查

| 现象 | 原因线索 | 处理 |
| --- | --- | --- |
| 类型检查通过但没有dist | `noEmit`正常行为 | 运行生产构建 |
| 修改dist后失效 | 生成目录被覆盖 | 回到对应源码修改 |
| Worker文件找不到 | 桌面构建未完成或资源漏包 | 检查三个入口与目录产物 |
| 构建时文件占用 | 正在运行的测试/打包进程 | 顺序执行，保留错误日志 |

## 本章验收与练习

验收：能画出两条构建路径与最终入口。
验收：能找到产物并说明它们对应哪些源码。
验收：知道检查、构建、打包、运行是四种不同动作。

练习1：为什么不把 `better-sqlite3` 放进浏览器 bundle？
参考：它是依赖原生能力的 Node 模块，渲染器没有这些权限。
数据库访问应留在受控的本地进程。

练习2：新增一张教材截图只放进源码目录是否足够？
参考：不够。还要经白名单构建复制并验证打包后离线可见。

练习3：找出 `dist/desktop` 中一个你没理解的文件。
提示：先用构建脚本查来源，再查启动链，避免从压缩产物倒推全部架构。

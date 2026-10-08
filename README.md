# RainSoul

RainSoul 是面向 Windows 的本地写作工作台，采用 Electron、React/TypeScript、Tiptap 和 SQLite。

开发基线为[立项方案 V2.0](docs/Rain_Soul_项目立项方案_V2.0.md)、[PRD](docs/Rain_Soul_PRD.md)及[技术方案](docs/Rain_Soul_技术方案.md)，界面沿用[工作台 Demo](docs/demos/rainsoul-writing-style.html)。本指南介绍开发运行方式，不另行定义需求。

## 当前开发范围

首批代码已接入真实本地存储：创建/打开作品、添加章节、章节标题与固定样式正文编辑、实时字数、撤销重做、自动保存、失败后显式重试，以及正常切换和关闭前的保存保护。启动第二个实例会聚焦已有窗口。

作品按独立 ID 保存；同名作品互不混用。自动保存停顿间隔为 500ms，持续输入按最多 5 秒提交的基线处理；保存失败时草稿留在当前窗口，重试成功后才能离开。

知识库、剧情架构、伏笔架构等尚未交付的 P0 入口显示开发中；需求会话属于后置功能。当前代码是首批可运行基础，完整 P0 尚未完成。

## 开发环境与启动

当前开发验证环境为 Windows x64、Node.js 24。无需单独安装 Python、数据库服务或本地模型。完整浏览器测试需要系统已安装 Google Chrome；首次安装依赖需要网络。

在项目目录执行：

```powershell
npm install
npm start
```

`npm start` 自动执行生产构建后启动 Electron。正式写作窗口通过本机 `rainsoul://app/` 加载打包资源，不依赖 Demo 的 HTTP 预览服务。

## 本机数据

正常运行默认使用 `%LOCALAPPDATA%\RainSoul`，其中 `catalog.sqlite` 保存作品目录，每部作品位于 `Projects\<作品 ID>\project.sqlite`。实际路径可在设置页面查看；升级或重装前请保留整个数据目录。

正文不会写入浏览器 Demo 的存储，也不会上传到云端。当前 AI 尚未接入。正常关闭会等待保存，保存失败或输入法仍在组词时阻止关闭；强制结束进程、系统断电或系统强制终止不等于正常关闭保护，未落盘草稿仍可能丢失。

## 验证与目录打包

```powershell
npm run verify
npm run pack
```

`npm run verify` 依次执行 TypeScript 检查、ESLint、覆盖率测试、真实 Electron 集成测试和原有 Demo 浏览器测试。`npm test` 的覆盖率与桌面测试均自动前置构建，不需要先手动生成 `dist`。

原有 `tests/browser-setup.test.js` 会访问百度检查网络连通性，因此完整验证需要外网；这项测试的联网需求不代表写作客户端依赖网络。

| 命令 | 用途 |
| --- | --- |
| `npm run test:unit` | 单元与真实 React/Tiptap 组件行为测试 |
| `npm run test:coverage` | 单元/组件测试及核心模块覆盖率门禁 |
| `npm run test:desktop` | 先构建，再运行 Electron 集成测试 |
| `npm run test:demo` | 原有 Demo 与 Chrome 配置测试 |
| `npm run build` | 构建界面、主进程、预加载层和数据库工作线程 |

`npm run pack` 生成 Windows x64 目录包，输出位于 `release\win-unpacked`。目录包可以用于后续独立运行验证；此命令不代表 NSIS 安装、升级和卸载流程已经验收。

## Demo 与后续开发

Demo 是视觉和交互参考，包含示例数据及后置功能工作区；正式桌面代码从空作品开始，并以 SQLite 回执判断保存是否成功。Demo 中的模拟 AI、导出、备份等操作不能作为正式能力的证据。

完整 P0 仍需继续实现卷与章节排序/删除恢复、个人资料、剧情架构、伏笔与行内书签、写作特点、知识分类/标签/搜索、快照/归档、TXT/DOCX 导入导出、云端 AI 授权与候选审核、一致性及剧情分析、正文回写，以及安装升级迁移验收。开发顺序和质量门槛以技术方案为准。

# RainSoul

RainSoul 是面向 Windows 的本地写作工作台。把正文、剧情大纲、伏笔和写作素材放在同一部作品中，离线完成写作、保存、搜索和导出；需要 AI 时再配置自己的云服务。

采用 Electron、React/TypeScript、Tiptap 和 SQLite。当前版本 **1.3.3**，支持 **Windows 10/11 64 位**。

## 选择使用方式

| 方式 | 适合谁 | 需要准备 |
| --- | --- | --- |
| 安装程序 | 只想写作的用户 | Windows；无需 Node.js、Python 或数据库服务 |
| 从源码运行 | 开发者、跟随教材学习的用户 | Git、Node.js 24 LTS，首次安装依赖需要网络 |

### 安装程序

在 [GitHub Releases](https://github.com/Garzipher/Rain_Soul/releases) 查找安装器；只有发布者上传后才会出现，源码仓库不包含 EXE。

本机当前安装器位于 `release/current/RainSoul Setup 1.3.3.exe`；也可直接运行 `release/current/win-unpacked/RainSoul.exe`。使用目录包时须保留整个 `win-unpacked`，不能只复制 EXE。先退出旧实例，再打开新版；旧程序不会随着源码更新自动升级。

1.3.3 整理了全局控件、知识库与会话布局，并调整云端失败后的恢复状态。本轮按作者要求未运行测试，仅做静态检查和构建，界面与交互交由作者验证；不沿用旧版本的测试结果声称本版已验收。

当前安装器未签名，Windows 可能提示未知发布者。首次安装后的写作不需要网络；云端 AI 需要用户自己的服务配置。

### 从源码运行

安装 [Git](https://git-scm.com/downloads/win) 和 [Node.js 24 LTS](https://nodejs.org/)，在 PowerShell 中执行：

```powershell
git clone https://github.com/Garzipher/Rain_Soul.git
cd Rain_Soul
npm ci
npm start
```

上述地址取得 GitHub 上已发布的代码；本机尚未推送的提交不会随 clone 下载。使用 ZIP 时，先解压并进入包含 `package.json` 的目录，再执行后两条命令。

`npm ci` 按锁文件安装依赖，并由 `postinstall` 下载 Electron 运行时。请保留安装脚本；不要使用 `--ignore-scripts` 或只安装生产依赖。首次依赖及 Electron 下载需要网络，完成后即可离线启动。SQLite 使用随依赖提供的 Windows 预编译文件。

`npm start` 自动构建并启动正式桌面界面，不需要另开 Demo 服务，也没有 `npm run dev` 命令。日常源码启动不要求 Google Chrome。

## 开始写作

1. 在“作品集”中新建作品，或导入 TXT/DOCX 手稿。导入会先预览拆章，确认后创建新作品。
2. 打开作品，按需要添加分卷和章节。正文采用统一固定样式，实时显示本章字数；统计汉字、字母和数字，排除标点、空白及书签。
3. 输入停顿 500ms 后自动保存，持续输入最多每 5 秒提交一次。确认“已保存”后再进行重要操作；保存失败时保留当前草稿，点击重试。
4. 在写作页切换“剧情架构”“伏笔架构”，维护节点、状态及关联的章节/段落证据。正文书签可点击查看详情。
5. 用右上角“版本历史”创建和恢复快照；恢复会保留当前状态及旧历史。导出 TXT/DOCX 前会完成保存。

作品、卷和章节支持右键管理，也可用 `Shift+F10`。删除前确认，误删内容可在设置的本机数据区恢复。正常关闭会等待保存；强制结束进程或断电仍可能丢失未落盘内容。

## 知识库与拆书

知识按作品保存。先打开一部作品，再进入“知识库”；未选作品时按页面入口返回作品集。

- 按人物描写、景物描写、内心描写、经典引用等层级分类保存素材，每条知识可附多个标签。
- 卡片展示摘要和出处，点击原位展开。可搜索正文/知识、筛选分类和标签，标签按 AND 组合。
- 全局范围可以汇总查看；其他作品知识只读，复用时复制到当前作品并保留来源。
- “拆书工具”接受 TXT/DOCX、粘贴文本及公开网页。先预览原文、选择段落，再手工或借助 AI 提取；逐条审核后才入库。

网页获取只支持公开且有权使用的内容。登录页、付费页、部分依赖动态脚本的网站可能无法提取，可改用粘贴或文件导入。受限浏览器渲染仍处于安全验收阶段，当前正式客户端未启用。

### 灰字提示与语义检索

在段落末尾输入停顿后，灰字可提示当前作品知识中的原句余文及出处。`Tab` 接受，`Esc` 取消；未接受不保存、不计字数。打开 AI 工具或保留待审候选时暂停灰字。它是本机原句参考，与结合剧情生成新内容的 AI 续写分别使用。

语义检索用 BGE-small 在本机生成向量，可找到意思相近但措辞不同的知识；它不生成聊天或小说正文。**安装器含模型，源码启动默认没有捆绑模型**：在设置的本机检索模型区显式下载/导入并启用，建立作品索引后使用。模型固定版本资源约 24.5MB；停用或不可用时回退关键词，知识文本不因本机检索外发。

## 配置云端 AI

在“设置 → 云端模型”填写服务名称、服务地址、模型名称和 API Key，保存后使用。支持兼容 `chat/completions` 的公开 HTTPS 接口。例如 OpenRouter：

| 项目 | 示例 |
| --- | --- |
| 服务地址 | `https://openrouter.ai/api/v1` |
| 模型名称 | `openrouter/free` |
| API Key | 用户自行注册并创建；不要写入源码或提交 Git |

[OpenRouter 免费路由](https://openrouter.ai/openrouter/free) 的模型、额度与可用性由服务方决定，不能保证永久免费或随时可用。

在正文选区右键或右上角“AI 工具”调用润色、续写、纠错、一致性检查等操作。每次先核对服务、发送范围及费用提示，再确认；结果作为候选或建议，作者审核后才写入。原文变化会要求重新对比，确认改稿前保存保护快照。超时或额度不足时不自动重发。

“需求会话”按作品组织，可新建、改名和删除会话，草稿与消息保存在本机。云回答同样逐次授权；拆书建议默认不入库。当前没有内置本机聊天大模型。

## 保存与备份

默认数据在 `%LOCALAPPDATA%\RainSoul`，实际位置可在设置中查看。源码与安装版默认使用同一数据目录，启动前退出其他 RainSoul 实例。

用 `.rainsoul` 项目归档备份到自己选择的位置。导入归档会校验并创建新作品，不覆盖现有作品；TXT/DOCX 是手稿交换格式，不能替代完整项目备份。更换电脑时，各作品分别导出归档并导入；云凭据及模型不随项目归档迁移，需要单独配置。

API Key 使用 Windows 本机安全存储，不进入作品归档。卸载默认保留作品数据；主动选择删除前请先备份。

## 项目实践教材

首次启动会在作品集中提供“项目全流程开发学习”，当前九卷四十五章、二十八张离线图片。图文阅读包含技术原理、真实项目代码、跟做步骤、系统截图、排错和拓展练习，也可查看 Markdown 源文。

教材源在 [learning/项目全流程开发学习](learning/项目全流程开发学习/)，构建时随应用打包；新版教材不覆盖作者已有正文。普通小说仍使用固定样式编辑器。

## 开发与验证

| 命令 | 用途 |
| --- | --- |
| `npm start` | 构建并启动桌面程序 |
| `npm run build` | 生产构建 |
| `npm run typecheck` / `npm run lint` | 类型与静态检查 |
| `npm run test:unit` | 单元及组件测试 |
| `npm run test:coverage` | 核心模块覆盖率门禁 |
| `npm run test:desktop` | 构建后运行真实 Electron 集成测试 |
| `npm run test:demo` | 原型与浏览器测试 |
| `npm run verify` | 类型、Lint、覆盖率、桌面及 Demo 全部验证 |
| `npm run test:report` | 打开 Demo HTML 报告 |

完整验证还要求系统安装 [Google Chrome](https://www.google.com/chrome/) 和可见的 Windows 桌面。搜索性能测试期间保持临时窗口显示，不能最小化。没有模型研究资料或指定实际 EXE 时，相关专项可能跳过；常规验证不代表真实云效果、干净系统安装或正式渲染资格全部通过。

更新依赖时注意：当前 npm 的 lock 虚拟树可能丢失 SQLite 的 `gypfile: false`。`package-lock.json` 中保留该上游标志，配置回归测试会检查；勿以禁用所有安装脚本来解决原生编译错误。

### 打包

无需先准备模型的目录包：

```powershell
npm run pack:research
```

输出到新的 `release/research-without-model/<UUID>/win-unpacked`；此包默认使用关键词，也可在设置中显式安装本机检索模型。

含模型正式包需先取得固定权重、许可和来源材料，并通过现有准备工具写入 `dist/retrieval-model/<revision>`，再执行 `npm run pack:installer`。常规 `build` 不下载模型，干净 clone 不能跳过准备直接打出同等捆绑包。准备工具说明见 [模型准备](scripts/prepare-bundled-retrieval-model.mjs)，固定身份见 [模型清单](assets/retrieval-model-manifest.json) 与 [来源记录](assets/retrieval-model-provenance.json)。

### 常见启动问题

- **Electron 下载失败：**检查到 GitHub/Electron 下载源的网络连接后重新执行 `npm ci`。若默认下载源不可达，可在 PowerShell 中临时使用以下镜像（本轮 Windows 净安装已实测）；完成后清除该环境变量。不要复制其他版本的 Electron 文件冒充安装成功。

  ```powershell
  $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
  npm ci
  Remove-Item Env:ELECTRON_MIRROR
  ```

- **提示 node-gyp 或缺少 Visual Studio：**核对 Node 24、锁文件及 SQLite 的 `gypfile: false`，按 `npm ci` 安装。
- **仍打开旧界面：**退出全部旧 RainSoul 实例，再从新版安装位置启动；更新源码需重新运行 `npm start`，旧 EXE 不会自动变化。
- **AI 不可用：**检查自己的服务、模型、Key 和额度；离线写作不依赖 AI。

## 目录与开源内容

| 目录 | 内容 |
| --- | --- |
| `src/` | 主进程、预加载、界面与数据库/检索线程 |
| `tests/` | 自动化测试、夹具与样例；随源码保留 |
| `scripts/` | 构建、模型准备和验收工具 |
| `assets/` | Logo、模型清单、第三方许可资料 |
| `docs/` | 立项、PRD、技术方案、设计规格和 Demo |
| `learning/` | 项目实践教材及图片 |
| `tasks/` | 开发决策、验收结论与证据索引 |
| `.trae/` | AI 开发规章与技能；普通用户运行不依赖 AI 开发工具 |

`node_modules/`、`dist/`、`release/`、`.artifacts/`、本机模型研究资料及凭据被 Git 忽略，不随 clone 下载。报告、截图和日志集中到 `.artifacts/`；旧安装包已物理删除，其验收证据保留于本机 `.artifacts/archive/release-evidence-20261014/`。当前有效安装包在 `release/current/`。测试源码与测试结果分别保存，不把测试源码当作垃圾删除。

## 状态与文档

当前客户端提供写作、知识/分类/引用、剧情/伏笔、云 AI、需求会话、拆书、关键词/本机语义检索、版本/归档和 TXT/DOCX 导入导出。跨作品分析、XMind、EPUB/PDF 等仍后置；正式动态网页渲染、干净 Windows 安装/升级/卸载矩阵及部分云操作验收尚未完成，当前版本不宣称全部发布门禁通过。

- [立项方案 V2.0](docs/Rain_Soul_项目立项方案_V2.0.md)
- [PRD](docs/Rain_Soul_PRD.md) · [技术方案](docs/Rain_Soul_技术方案.md)
- [工作台 Demo](docs/demos/rainsoul-writing-style.html)
- [1.3.3 界面整改与验证说明](tasks/ui-redesign-2026-10-14.md)
- [1.3.2 验收与目录整理](tasks/release-layout-2026-10-14.md)
- [GitHub 发布准备检查](tasks/github-readiness-2026-10-14.md)

项目使用 [ISC 许可证](LICENSE)。第三方代码、运行库及 BGE 模型遵循各自许可；发布安装包时保留随包版权声明。AI 服务和作者自己的作品不因项目许可自动获得授权。

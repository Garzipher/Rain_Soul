# 第三章 开发能运行不等于打包能运行

本章状态：Windows目录包已有真实运行验收；本轮把Demo Logo接入窗口和EXE资源。NSIS安装、签名、升级卸载与Windows11干净环境仍待验收。

学习目标：理解静态资源、原生SQLite驱动和运行入口在打包后都可能变化，必须运行最终产物验证。

Demo图形源在 `docs/demos/rainsoul-writing-style.html`：天蓝描边的圆角方框、浅蓝底、负9度旋转和中心蓝点。正式侧栏保持同样图形，标题为RainSoul，不能悄悄换成另一套品牌。

查看 `assets/rainsoul.svg`、PNG和ICO，以及 `scripts/generate-app-icon.mjs`。同源生成使侧栏、窗口和可执行文件图形一致；ICO需要包含Windows可识别的尺寸和有效图像数据。

实践步骤：

1. 运行图标生成入口，确认资源能离线重生成。
2. 对照 `src/main/index.ts` 的BrowserWindow icon路径。
3. 对照 `scripts/build-desktop.mjs` 的资源复制和package.json的win.icon。
4. 运行 `npm run pack`，不要只检查源码里的文件存在。
5. 从 `release/win-unpacked/RainSoul.exe` 启动并检查窗口图标与写作功能。

`better-sqlite3` 含原生模块，Node开发测试能加载不能证明Electron也能加载。当前版本实测使用兼容的Node-API预编译文件，打包时正确解包 `.node` 文件；将来升级驱动后仍需再验证。

目录包验收需要断网创建/打开作品、编辑、正常关闭、重启读回，并检查卷章删除恢复。测试通过环境变量选择真实EXE，复用开发版验收流程。

```text
源码与资源 → Vite/桌面构建 → ASAR与原生模块解包
→ Windows目录包 → 真实EXE离线操作 → 重启读取
```

运行桌面测试时不要并行构建覆盖dist，内存紧张时也不要同时跑覆盖率、打包和多个Electron。资源争用导致的超时需要诊断，不能直接延长等待掩盖状态错误。

证据入口：`tests/unit/app-icon.test.ts` 检查图标资源；`tests/desktop/writing.spec.cjs` 与 `structure.spec.cjs` 检查真实应用；`tasks/structure-management.md` 记录上一批目录包验收。

作品默认目录是 `%LOCALAPPDATA%\RainSoul\Projects`。验收必须使用独立临时目录，不能拿作者作品冒险；包内也不应包含数据库、密钥或测试档案。

练习：列出开发入口、目录包和NSIS安装包三种运行方式各自新增的风险，再标记当前已验证和仍待验证的项目。

边界：目录包可运行不等于安装升级已验收。卸载默认保留作品数据、迁移失败阻止启动等承诺需要后续专项验证，不把配置存在当作验收完成。

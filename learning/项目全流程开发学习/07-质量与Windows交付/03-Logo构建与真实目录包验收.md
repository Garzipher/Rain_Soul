# Logo构建与真实目录包验收

Demo里看见正确Logo，不代表Windows EXE也使用了它。
本章把侧栏、窗口和程序图标三种资源沿构建链路连起来。
完成后，你能生成目录包，并知道移动时为什么必须保留整个文件夹。

**状态说明（2026-10-09）：**同源 Logo、Windows 目录包与 NSIS 安装器构建链路已存在。
构建成功不代表干净 Windows 安装、原位升级、卸载与真实云端模型验收已完成。

## 技术基础：资源、目录包与安装器

### 图标的三种表示

SVG 用几何指令描述图像，可按比例缩放；PNG 保存像素；ICO 在一份文件里放多种图标尺寸，Windows 按场景选取。侧栏 CSS、窗口 PNG、EXE 内嵌 ICO 是三个出口，保持同一几何来源可以减少不一致。

文件内容更新后，Windows 的图标缓存仍可能暂时展示旧图。应该同时核对资源字节和实际程序路径，不能只看资源管理器缩略图。

### 打包不是把仓库全部复制出去

electron-builder 收集 `dist`、必要 npm 运行依赖与 Electron 运行资源。ASAR 是打包应用代码的归档格式，不是加密；原生模块按配置解包，才能被系统加载。测试输出、源码草稿和历史 EXE 不应成为正式包的数据来源。

目录包必须携带整个 `win-unpacked`，只有一个 EXE 无法独立运行。NSIS 安装器将这些必要文件安装到目标目录并创建启动入口，接收者通常只需要安装器，无需装 Node/npm/Python。

### 为什么旧 EXE 一直是旧程序

EXE 加载同目录的固定构建资源，不会自动读取仓库最新源码。`git merge` 改变源码状态，`npm run build` 改变生成产物，`npm run pack:installer` 生成分发文件。三个动作都不会让已经运行的旧进程自动变成新版。

构建目录、版本号和启动入口应统一。已生成新版并验收后，再清理确认无用的旧程序目录；用户作品在 `%LOCALAPPDATA%\\RainSoul`，不能把它当旧代码删除。

### 可以怎样分发

当前目标是 Windows 10/11 x64、普通用户本机安装。未签名安装器可能出现未知发布者或 SmartScreen 提示，签名证书是分发信誉措施，不是绕过系统保护的方法。开源依赖许可证和 Electron/Chromium notices 必须保留，不能为了减小包删除法律说明。

本地写作离线；云端 AI 需要作者自配服务与凭据，费用取决于其供应商。打包并不附赠模型账号，也不证明每个厂商私有协议兼容。下面的验收分别核对资源、运行和安装边界。

## 1. 前置知识

认识SVG、PNG和ICO三种格式。
SVG适合描述矢量几何，PNG用于像素图片，ICO容纳Windows所需图标尺寸。
知道源码资源只有进入dist与打包清单，用户才看得见。
本章使用项目已有工具与锁文件，不额外装图形软件。

```powershell
Set-Location E:\soulrain
node --version
Get-Content .\scripts\generate-app-icon.mjs
Get-Content .\scripts\build-desktop.mjs
```

## 2. Demo Logo的几何

Demo中的标记是旋转约-9度的圆角方框。
方框使用天蓝描边和浅蓝底，中心是一个蓝点。
旁边标题是RainSoul。
它不是默认Electron标志，也不是任意新生成的品牌图。

侧栏可以用CSS画同样几何。
BrowserWindow.icon需要实际图片路径。
Windows打包则需要ICO资源。
三处保持同源，避免每种出口长得不同。

查看资源：

```powershell
Get-ChildItem .\assets\rainsoul.* | Select-Object Name, Length
```

预期看到SVG、PNG和ICO，而不是只有一份CSS。

## 3. 跟做：生成并验证图标

```powershell
npm run generate:icon
npm run test:unit -- tests/unit/app-icon.test.ts
```

生成脚本离线使用既有图形定义。
测试核对图标内容与格式，尤其ICO多个尺寸的结构。
若测试失败，先看实际资源字节和生成脚本，别换成随机图片绕过。
资源改动应和相关验证一起提交。

## 4. 构建如何把PNG送到窗口

主进程在BrowserWindow设置icon路径。
路径相对打包后的desktop目录，而不是相对仓库assets。
build-desktop.mjs必须复制PNG到那个位置。

真实复制步骤：

```javascript
await copyFile('assets/rainsoul.png', 'dist/desktop/rainsoul.png');
```

先生成资源，再构建，最后窗口才能在运行时找到它。
如果只在开发目录能找到assets，打包后容易失效。
构建时验证资源存在，可以提前发现这种问题。

## 5. Windows打包图标从哪里来

package.json的build.win.icon指向assets/rainsoul.ico。
这个图标用于Windows程序资源，与窗口运行时PNG不是同一配置项。
package.files包含dist与必要package信息。
better-sqlite3原生模块还有相应解包配置。

```powershell
Get-Content .\package.json | Select-String -Pattern 'icon|asar|npmRebuild' -Context 1,2
```

理解配置用途比单纯复制字段更重要。
原生模块与Node/Electron ABI有关，不能任意改版本后假定仍能运行。

## 6. 跟做：构建与目录包

```powershell
npm run typecheck
npm run lint
npm run build
npm run pack
```

pack自身也会执行build；单独build用于观察构建问题。
实际常规交付不必无理由重复相同构建。
预期目录包位于：

```text
E:\soulrain\release\win-unpacked\RainSoul.exe
```

这里的EXE需要相邻资源一起运行。
移动时复制整个win-unpacked目录，不能只抽出EXE。
目录包不是自动更新服务，也不是公开发布结果。

## 7. 为什么打包入口有文件锁适配

scripts/pack-desktop.mjs核对electron-builder和app-builder-lib版本。
当前适配只验证过26.15.3。
它包装原addWinAsarIntegrity，只针对Windows短暂open锁做有限重试。
并未跳过ASAR完整性，也未关闭安全校验。

升级打包工具后，必须重新验证内部接口。
“把异常吞掉后打包成功”不可信，最终包可能缺少资源或完整性信息。
脚本默认publish为never，不自动上传发布产物。

## 8. 跟做：开发入口与目录包都验收

先跑开发入口：

```powershell
npm run test:desktop
```

再用同一套测试检查目录包：

```powershell
$env:RAINSOUL_TEST_EXECUTABLE = 'E:\soulrain\release\win-unpacked\RainSoul.exe'
npx playwright test --config playwright.desktop.config.cjs
Remove-Item Env:RAINSOUL_TEST_EXECUTABLE
```

测试helpers隔离LOCALAPPDATA与APPDATA，避免污染真实作品。
清除本次环境变量，防止下一轮误测旧包。
两套测试按顺序跑，不并行覆盖dist或争用桌面资源。

## 9. 观察真实用户体验

![默认作品集](images/shelf.png)

核对侧栏Logo、作品集标题、默认学习作品与折叠导航。
打开《雨落之后》，写一句话后正常关闭，再重开确认。
阅读设置显示的本机路径，确认无需联网可写作。
当前 AI 适配已实现，每次云端请求须先预览与授权，不允许默认上传正文。

Windows图标缓存可能让刚替换的文件仍显示旧图标。
这时同时核对EXE资源、窗口图标和实际构建输出日期。
不要仅凭资源管理器缩略图判定生成脚本错误。

## 10. 卸载的数据边界与真实实现

### NSIS 与程序清理器的分工

NSIS 是 Windows 安装/卸载脚本系统。`assets/installer.nsh` 为交互卸载增加选择：首框 Yes/No/Cancel 默认 No；No 保留本机数据并继续，Cancel 中止卸载供作者先备份，Yes 还需二次确认。升级和静默卸载始终保留作品。

NSIS 不直接拼任意目录执行递归删除，而是启动 RainSoul 的专用卸载模式。`src/main/index.ts` 检查明确清理参数和确认标志，取得单实例锁，不创建窗口、数据库或默认教材，再调用 `cleanupLocalData`。退出码 0 表示完成，2 表示运行实例占用，3 表示缺少确认，4 表示清理失败。

### 清理目录为什么要先隔离

`src/main/uninstall-cleanup.ts` 固定只允许当前用户 `%LOCALAPPDATA%\\RainSoul`。它验证普通绝对路径，拒绝磁盘根、符号链接和 Windows junction，遍历全树预检；同父目录原子 rename 到隔离目录后，再次预检，并在逐项删除前核对路径和祖先。

```text
取得实例锁 → 固定目录/祖先/全树检查
→ 同父目录原子隔离 → 再检查 → 逐文件删除 → 清空目录
```

删除不是数据库事务。隔离之后若中途失败，部分文件可能已经删除，剩余隔离目录不是完整备份。程序明确显示路径与残余风险，安装器中止并保留程序，不能宣称“自动完整恢复”。

导出的 TXT/DOCX 与用户选择位置的 `.rainsoul` 不在固定清理目录，不受此操作影响；但本机作品、资料、配置和加密凭据都在选择删除范围中。用户应先自行导出需要的完整备份。

### 怎样安全验证卸载逻辑

`tests/unit/uninstall-cleanup.test.ts` 在临时目录验证未确认、junction、占用、失败残余和目录外文件保留。`tests/desktop/uninstall-cleanup.spec.cjs` 使用隔离环境验证真实 Electron 专用模式；它们没有卸载作者当前程序。

```powershell
npm run test:unit -- tests/unit/uninstall-cleanup.test.ts
npx playwright test --config playwright.desktop.config.cjs uninstall-cleanup.spec.cjs --workers=1
```

真正安装、升级、卸载测试应在虚拟机或独立 Windows 用户进行。NSIS 的 `/D=` 只改变安装目录，不能隔离当前用户 HKCU 注册项；切换文件夹不等于安全沙箱。当前实现与上述隔离自动化已有验证，真实新机器安装仍需另记结论。

## 11. 故障诊断与练习

| 现象 | 先检查 | 常见原因 |
| --- | --- | --- |
| 窗口图标缺失 | dist/desktop/rainsoul.png | 构建未复制资源 |
| EXE仍是默认图标 | ICO与win.icon配置 | 只改了窗口PNG |
| 拷EXE后不能运行 | 相邻资源文件 | 目录包被拆散 |
| 包可启动却数据库报错 | 原生模块与ABI | 依赖或解包配置不匹配 |

练习一：为何侧栏正确不能证明EXE图标正确？
答案：CSS、运行时PNG、程序ICO是不同出口，必须分别接线。

练习二：为什么开发测试通过后还要测试目录包？
提示：包内路径、原生模块、资源清单与开发目录不同。

## 延伸检查：交付包的身份

验证EXE前，先记录本次构建时间、Git版本和包目录。
如果工作区代码比release里的包更新，旧EXE无法代表新实现。
测试报告也应说明使用开发入口还是目录包，不能把两者结果混写。
确认本次测试结束并释放进程后，再重新生成目录包，避免文件仍被Windows占用。
只清理本次测试创建的进程，不结束作者已经打开的其他客户端。

目录包交付还需要说明普通用户是否可运行。
本机管理员身份能启动，并不能证明标准账户安装和运行权限正确。
当前包验证、NSIS 构建与真实安装/原位升级验收应分别记录。
卸载默认保留作品数据，是产品决策；不能只因为程序目录可删除就判断卸载安全。
数据目录、程序目录和测试隔离目录也要分别写清，避免误删唯一稿件。

交付时还应让接收者明确知道这是目录包，避免把它当成独立安装器使用。

本章检查点：你能沿资源源文、构建、运行窗口与EXE四步追踪Logo。

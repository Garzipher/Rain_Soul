# Logo构建与真实目录包验收

Demo里看见正确Logo，不代表Windows EXE也使用了它。
本章把侧栏、窗口和程序图标三种资源沿构建链路连起来。
完成后，你能生成目录包，并知道移动时为什么必须保留整个文件夹。

**状态说明（2026-10-08）：**同源Logo和Windows目录包链路已经存在。
npm run pack输出可运行目录包，不代表已发布安装器或完成全部P0。

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
当前网络AI能力未完成时，不应通过默认联网请求假装已有功能。

Windows图标缓存可能让刚替换的文件仍显示旧图标。
这时同时核对EXE资源、窗口图标和实际构建输出日期。
不要仅凭资源管理器缩略图判定生成脚本错误。

## 10. 故障诊断与练习

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
当前包验证与未来NSIS安装、原位升级验收应分别记录。
卸载默认保留作品数据，是产品决策；不能只因为程序目录可删除就判断卸载安全。
数据目录、程序目录和测试隔离目录也要分别写清，避免误删唯一稿件。

交付时还应让接收者明确知道这是目录包，避免把它当成独立安装器使用。

本章检查点：你能沿资源源文、构建、运行窗口与EXE四步追踪Logo。

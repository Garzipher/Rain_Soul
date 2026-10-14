# GitHub 发布准备检查（2026-10-14）

## 结论

当前发布文件树已整理，净源码安装、生产构建、静态检查、离线启动及可执行测试通过。按作者后续要求，完整最新代码已统一到本机 `main`，旧分支历史中的大EXE也已清理；未实际推送GitHub。初次准备使用 `codex/github-ready`，该过渡分支无需再作为日常开发或推送入口。

这不等于全部产品发布门禁通过。正式动态网页渲染、干净 Windows 安装/升级/卸载矩阵和部分真实云操作仍按原验收台账待验。

## 文件整理

- 根目录两套外部参考仓库移至 `.artifacts/archive/reference-repositories-20261014/`，原资料保留；208 个曾被跟踪的参考文件停止跟踪。
- `src`、`tests`、`scripts`、`assets`、`docs`、`learning`、`tasks` 与项目开发规章保留。测试是必要源码，不整体忽略。
- `node_modules`、`dist`、`release`、`.artifacts`、本机模型研究资料和本机凭据由 `.gitignore` 排除。当前文件树不包含安装程序、作者数据库或生成报告。
- 工作区仍有本机依赖、当前安装包、研究模型和归档证据，它们不随源码发布。后续已物理删除 `release/archive`：2855个旧文件、27个EXE，8227369992字节；68份验收证据校验后移至 `.artifacts/archive/release-evidence-20261014/`，当前1.3.2两个入口SHA-256保持一致。删除清单见 `.artifacts/manifests/old-release-deletion-20261014.json`。
- 使用说明见根目录 README；新增 ISC LICENSE 与现有 package.json 许可声明一致。第三方运行库与模型仍遵守各自许可。

## 净源码复现

使用 `git archive` 创建独立源码目录，不复用原工作区 node_modules、dist 或研究模型。环境为本机 Windows、Node.js 24.16.0、npm 11.13.0。它不是干净 Windows 虚拟机。

| 项目 | 本轮结果 |
| --- | --- |
| npm ci | Electron 默认下载卡住；临时设置 README 所列镜像后成功安装 693 个包 |
| 安装修复 | SQLite 锁文件保留上游 gypfile:false，避免错误编译；项目 postinstall 显式安装 Electron |
| TDD | 安装元数据回归先失败，修复后通过；1 项配置测试通过 |
| typecheck / lint | 独立源码目录退出码 0 |
| npm run build | 生产构建成功 |
| 单元/组件与覆盖率 | 169 个文件；1563 项通过，2 项缺研究模型跳过；语句93.09%、分支88.73%、函数94.98%、行97.89% |
| 桌面全集 | 初轮31项通过，2项实际安装包专项跳过；搜索因窗口最小化中止 |
| 搜索针对复验 | 1项通过；200样本P95=190.40ms，门槛仍为1000ms；未丢弃慢样本补抽 |
| Demo | 74项通过 |
| npm start | 构建并启动真实Electron；隔离数据、离线作品集与教材入口通过；写作/正常关闭/重启恢复另由桌面全集通过 |

初轮 `npm run verify` 因搜索环境失效退出非零，未宣称单次全集全部成功。修复测量条件后仅复验失败项，并补跑未执行的 Demo；可执行范围最终全部通过。模型/实际包专项跳过不计作通过。

首次 npm start 烟测已完成页面断言，但附加截图等待超时；第二轮保留页面断言、取消非必要截图后退出0。未改产品代码或放宽功能门槛。

## 依赖与凭据

官方 npm audit 的生产依赖报告为0项；完整开发依赖报告为8条 moderate、0 high、0 critical，均来自 electron-builder → @electron/get → global-agent → roarr → sprintf-js 同一依赖链。sprintf-js 最新公开版仍为1.1.3，无对应修复版。公告针对攻击者控制格式字符串精度导致资源耗尽；此链用于本机构建/下载，未进入桌面运行依赖。保留风险记录，不盲目采用 audit 建议的打包工具降级。

常见凭据格式扫描未发现项目 Key；凭据/环境配置忽略规则已核对。历史8条AWS格式匹配属于旧Electron二进制内置字符串，非项目凭据。模式扫描不等同于发现任意格式的全部秘密；聊天里曾公开的旧Key仍应由账号所有人撤销，无法从源码审计确认其状态。

## Git 历史与推送

原分支历史含 `release/win-unpacked/RainSoul.exe`，246302720字节。只删除当前文件不能消除GitHub的100MB限制。

初次在完整隔离克隆中运行 git-filter-repo 的 `--strip-blobs-bigger-than 100M`，过滤前后文件树一致，远端主线 `e49b2b73d034d1894c74e88a72c4273a8eb1878e` 仍为祖先。后续作者明确要求删除旧EXE并统一main：先比对最新源码树与旧开发分支一致，再将main与开发引用指向等价的清理历史；另一旧功能分支也核对过滤前后源码树一致。完成引用清理后，用Git清除旧回退记录并回收旧对象，主仓库与隔离副本均清理，不再保留旧EXE的Git对象。

本机main包含最新源码、测试、教材、README与许可；不采用把含大EXE的旧main合并回新主线的方式。main跟踪origin/main，保留功能提交；过滤涉及的旧提交哈希发生变化，但不丢弃当前源码。仅推送main即可，无需force或推送全部分支。

用户决定发布后可执行：

```powershell
git push origin main
```

若远端主线没有新增不兼容提交，上述推送可前向更新；如GitHub有保护规则，应按保护规则提交PR，不能强推。推送成功后README中的普通clone命令取得新版：

```powershell
git clone https://github.com/Garzipher/Rain_Soul.git
cd Rain_Soul
npm ci
npm start
```

初次曾成功获取远端主线，后续一次获取发生连接重置；再次执行 `git push --dry-run origin main` 退出0，预检显示 `e49b2b7..62dabb7 main -> main`，未实际更新远端。本机main统一不等于GitHub上的main已经更新，正式推送仍须遵守届时的远端状态与保护规则。

## 后续main清理验证

本轮主线业务代码、测试与构建配置相对完整最新基线没有变化，仅修订本文、README及历史目录台账。主仓库和隔离副本都已通过旧EXE对象不存在检查；全对象检查无超过100MiB的blob，Git fsck通过，旧main的等价清理历史仍为新main祖先。凭据模式扫描、被跟踪的生成物与README相对链接检查无命中或损坏。

主线上重新执行typecheck、lint、单元、桌面与Demo。首次单元全集169文件中168通过，1564项通过、1项失败；失败点是资产回执重试后切换正文的异步等待，错误快照仍显示资产编辑保护。随后单独重跑失败项通过，再以覆盖率采集模式复验整个相关文件5项全部通过，业务和测试代码均未改变，不将首次失败隐去。单文件覆盖率采集关闭总体百分比阈值仅用于定位，不替代全项目80%覆盖率门禁；上节93.09%等覆盖率是此前同一业务源码的净安装全集证据。

主线桌面测试32项通过、2项缺显式安装包入口跳过；200个真实搜索样本P95=233.30ms，门槛仍为1000ms。Demo测试74项通过，失败项复验、桌面、Demo三阶段退出码均为0。本轮验证使用独立临时作品，作者作品未用于测试。

主线新证据位于 `.artifacts/github-readiness/`：main-final-audit.json、main-gc.log、duplicate-gc.log、main-verify-20261014.log、renderer-assets-retry.log、renderer-assets-coverage-retry.log、main-desktop.log、main-demo.log、main-followup-exit.json和main-push-dry-run.log。删除清单记录68份验收证据的SHA-256与当前有效EXE校验值。

## 源码与安装器边界

源码不含作者Key和模型权重：云端AI需用户自己配置；语义模型需显式下载/导入，否则关键词仍可使用。源码不是双击即可运行，需要Node与首次依赖下载；普通作者可使用单独发布到Releases的Windows安装器。正式含模型打包还需按README准备模型，`pack:research`可生成无模型包。

## 审查与证据

主责流程：document-release、systematic-debugging、test-driven-development、gstack review、verification-before-completion；规则来源为项目 `.trae/skills` 与全局 `C:/Users/NO.6/.codex/skills/gstack-review`。两项安装改动独立审查及主代理复核无High/Medium代码问题，依赖风险按上节保留；未对整个既有业务代码宣称重新完成全面安全审计。

本机证据均位于 `.artifacts/github-readiness/`：npm-ci-mirror.log、install-runtime-red/green.log、build-final.log、verify-clean.log、search-retry.log、demo-clean.log、retry-exit.json、npm-start-result.json、npm-audit-official.json、npm-audit-production.json、history-filter.log及最终发布审计。外部参考清单位于 `.artifacts/manifests/`。它们被忽略，不进入公开仓库。

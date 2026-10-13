# 受限网页渲染资格记录

本记录区分实际 Electron 机制验证、受控目标监听与正式构建资格。当前生产能力 `enabled=false`，政策版本 1；未生成可放行记录。

## 可重现运行

```powershell
node scripts/qualify-restricted-render.mjs E:/soulrain/test-results-restricted-render/runtime-report.json
npx playwright test --config playwright.desktop.config.cjs tests/desktop/restricted-web-runtime.spec.cjs --output test-results-restricted-runtime
```

脚本将生产 broker、网络防护、观察器、窗口生命周期打包到临时测试入口，独立运行 Electron，使用独立用户目录。测试入口只注入受控 DNS 与响应传输，生产入口不读取测试环境或增加 IPC 绕过。生产 `dist` 不被改写。报告包含实际运行时间、平台、Electron 版本、运行二进制与测试 bundle SHA256、输入夹具 hash、broker 请求路径、观察/清理阶段、剩余 webContents 和任务进程，以及受控 TCP 连接/上传字节/UDP 包计数。

## 已观察事实

- Electron 44.7.0，Windows；运行二进制 `node_modules/electron/dist/electron.exe`。
- 二进制 SHA256：`2529b494f4123f152bce346051f7bd855ef95006424a561953cf17c49a3d1ba8`。这是开发依赖的 Electron 二进制 hash，不是 RainSoul 正式 EXE 或 app.asar 的资格证明。
- 真实内联 JavaScript 与同源外部脚本生成文章；外部脚本的 fetch/XHR 均实际经过 broker。成功正文保存独立 DOM hash。
- 跨源 script 和被页面 catch 的跨源 fetch 在 CSP 提前拒绝时，broker 仅收到主文档；观察器报告 script/connect 失败，任务拒绝正文。
- 私网 HTTPS POST 目标监听未接到 TCP 连接或上传字节；任务拒绝正文。
- 无限循环页面取消时，主进程仍执行取消，任务独立 renderer 被结束，窗口销毁。正式完整回归结果见下方运行记录。
- 测试发现正常 CDP 清理与窗口销毁并行导致 `target closed while handling command`；已增加回归测试并改为等待观察器关闭。死循环页面还会阻塞同步 debugger.detach，取消改为移除宿主观察监听，再结束已核对的任务进程并销毁窗口。

21 项定向单元通过，覆盖关闭顺序、取消终止模式、一秒清理期限、正常结束任务进程、身份或共享关系变化时不得误杀作者进程，以及生产适配器窗口配置。类型检查和定向 ESLint 通过。实际并发运行曾触发一秒清理门禁，未将这些清理错误计为负向隔离通过；停止并发验证后保持原期限串行复核，六项全部通过。

最终运行：`2026-10-13T06:04:56.492Z`，纳入32场景完整桌面回归，该运行时场景包含六夹具全部通过。原始报告：`test-results-final-research-pack/restricted-web-runtime-真实Electron动态正文、CSP提前拒绝与死循环取消清理/restricted-render-runtime-report.json`，另持久保存于研究包 `release/research-without-model/35492ba6-3fc7-4034-a7e3-c2230f157386/acceptance/`。测试 bundle SHA256：`fdaf69bc4d606046625c261792d6847e341cb202e8b0c9ef4a2860313a0cc839`；该轮输入夹具 hash：`e88429d4c80db4225a9ec51061c19306a37d0099311a10da62d0672db81060b0`（包含随机监听端口）。

| 夹具 | 结果 | 耗时 | 任务进程/窗口剩余 |
| --- | --- | --- | --- |
| 内联脚本生成正文 | passed | 9413ms | 0 / 0 |
| 同源外部 script/fetch/XHR 正文 | passed | 891ms | 0 / 0 |
| CSP 跨源脚本提前拒绝 | passed | 250ms | 0 / 0 |
| CSP 跨源 fetch 即使被页面 catch | passed | 186ms | 0 / 0 |
| 私网 HTTPS POST 拒绝 | passed | 165ms | 0 / 0 |
| 无限循环文档取消 | passed | 1132ms | 0 / 0 |

六项受控 TCP 连接、上传字节、UDP 包计数均为 0。输出保留 `productionCapability.enabled=false`，未据此提升生产资格。日志中的 `NO_COLOR`/`FORCE_COLOR` 冲突是 Playwright 终端色彩环境提示，不影响机制验证。

虽在指定新实际EXE的桌面全集中执行，运行时脚本依然启动开发依赖Electron与独立测试bundle；报告保存到研究包不改变其证据归属。产品EXE验证的是静态入口可用、受限入口资格禁用、旧来源/审核草稿兼容与小窗口交互。产品内实际动态渲染资格继续pending。

## 证据边界与剩余门禁

| 验证项 | 状态 | 适用边界 |
| --- | --- | --- |
| 实际 Chromium 动态正文、CSP 与取消机制 | passed | 最终串行六项通过；证明表列机制与清理结果 |
| 受控私网 TCP 目标零连接/零上传 | 已观察 | 仅指定本机目标和六类夹具，不等于全系统无出站 |
| UDP 监听零包 | 观察值 | 未主动执行 STUN/QUIC 探针，不能作为 WebRTC/QUIC 隔离证明 |
| 生产 broker HTTPS 固定 IP 真实传输 | 待验证 | 夹具替换 DNS/传输；独立传输单元覆盖不代替系统证据 |
| 系统网络审计 | pending | 未取得全进程 DNS/IPv4/IPv6/UDP 出站观测 |
| 完整旁路反例 | pending | DNS 重绑定、IPv6 私网、WSS、STUN、QUIC/WebTransport、预取/DNS预取、worker/service worker、iframe/srcdoc、blob/data、弹窗、下载、认证、代理故障无直连需要系统观测 |
| 正式安装包/EXE | pending | 未执行固定包 hash 对应的受限渲染验收；无模型研究包验证不替代本项 |
| 作者资料/凭据继承与干净 Windows 安装 | pending | 独立临时用户目录避免触碰作者数据；正式安装包的资料边界与安装环境仍需验证 |
| 固定构建能力与网络隔离总资格 | pending | 所有门禁通过且绑定实际包 hash 才能放行 |

资格脚本只输出证据和 `pending` 状态，不修改生产能力。负向案例必须出现预期安全/取消失败并完成清理；初始化或清理失败不能通过案例。

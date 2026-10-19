# 单句润色与剧情感受修复

## 范围与根因

承接 1.3.6 真实云验收的两项失败，基线为 main `edfb1c6`。原始失败证据保留在本机 `.artifacts/tests/release-acceptance-20261016/v136/`，不改写历史结果。

- 单句润色：实际响应是一句正文，外缘带空行。服务直接把响应交给候选，数据库的跨行保护在作者确认写入后才拒绝，原文、版本和快照保持不变。问题是把响应的包装空白当成正文内部换行。
- 剧情感受：响应以 `finish_reason=length` 结束。原通用输出上限为 2048 token，结构化报告还包含证据 UUID、摘录和不确定性，提示词没有约束报告篇幅。不能据此认定免费额度、余额或思考 token 是原因。

## 修复行为

单句响应仅裁去首尾空白，在展示候选前完成。候选对比和确认写入使用同一份文本。内部 CR、LF、Unicode 行/段分隔符仍被拒绝，不拼接多行、不猜测第一种写法；提示作者调整要求后重新预览。段落润色等其他操作的原始换行保持不变。

剧情感受的默认输出上限改为 8192 token，并要求最多三条主要建议、每条最多两条证据，限制原因、不确定性和摘录篇幅，不输出思考过程。输出上限仍在发送前预览，与完整请求一同冻结、计算哈希；上下文容量不足时明确拒绝，不静默缩减发送材料或输出预算。模型仍可能不遵循篇幅提示，实际截断继续按失败处理，不自动重发。

主责技能为项目 systematic-debugging、test-driven-development、verification-before-completion，按 GSD 分工准备实际包复验及独立 review/checklist 审查。项目已有 React/TypeScript 架构继续适用。

## 回归与证据

证据集中于 `.artifacts/tests/cloud-fixes-20261019/`，不包含明文凭据或作者作品。

- TDD 红：服务测试 6 项失败、51 项通过，证据 `service-red.log`。
- 定向绿：服务、正文应用、分析、命令四文件共 101 项通过，证据 `service-green.log`。
- 类型检查、Lint 退出码均为 0，证据 `typecheck.log`、`lint.log`。
- 独立代码审查未发现阻断问题；明确提示词篇幅约束与真实模型效果需要分别验证。

首次完整回归为 185 文件、1665 项，其中 1663 通过、2 失败，原始结果为 `coverage.log` 与 `unit-results.json`。两项均与本次 AI 服务修改无关，但不忽略失败：

- `renderer-assets` 在保存表单消失后立即查询搜索框，此时知识作用域仍可能重载。改为等待搜索框出现，保留真实加载和搜索断言，定向五项通过。
- `renderer-conversations` 用 Profiler 发现真实时序问题：已保存且可编辑的界面提交时，父级导航保护仍为 true。将轻量脏状态通知改用 `useLayoutEffect`；旧实现新增回归确定失败，修复后相关三文件 23 项通过。测试同时等待输入启用，结束时实际释放 SQLite 及临时目录；最终单文件三项再次通过。

相关原子提交：`c3df214`（知识测试等待）、`ee4d0eb`（两项 AI 修复）、`0d9d28a`（会话导航竞态）、`38ac74f`（1.3.7 版本）。最终完整回归使用独立 `coverage-final.log`，不覆盖上述失败记录。

最终完整覆盖率回归退出码 0：185 文件、1666 项全部通过，无失败或跳过，用时 763.95 秒。语句 92.49%、分支 87.74%、函数 94.66%、行 97.50%，均超过项目 80% 门槛。原始结果为 `coverage-final.log`、`unit-results-final.json` 和 `coverage-final/coverage-summary.json`。最终类型检查、Lint 与生产构建均成功。构建器提示教材插件耗时，属于构建性能提示；没有类型或打包错误。

按 review/checklist 复审 `edfb1c6..38ac74f` 未发现问题，材料为 `final-code-review.md`。1179 个当前跟踪文件的限定凭据扫描未发现 OpenRouter Key 文本或常见敏感文件路径，材料为 `tracked-secret-scan.json`；不等于完整 Git 历史秘密审计。

桌面全套在非输入 Windows 桌面运行，36 项中 34 通过、2 项原有条件跳过、零失败，退出码 0，用时 12.8 分钟。条件跳过分别要求显式指定无模型研究包和含模型正式包，不计为通过。后台进程和隔离数据已清理，`switched=false`。百万字/千条知识的 200 个正式搜索样本 P95 为 347.70ms，预热 20 次另计，满足 1 秒门槛。

原型首轮默认并发为 71 通过、3 失败，三项均在 `beforeEach` 的本地文件 `page.goto` 等待 load 超时，尚未进入业务步骤。保留 `demo.log` 和 `demo-first-output/`；改以 `--workers=1` 执行原有全部用例，未放宽超时、重试或业务断言，最终 74 项全部通过，证据 `demo-final.log`。正式构建/打包在回归结束后串行执行，退出码 0，ASAR 审计通过，随包模型资源保留。构建器的重复依赖引用提示不等于新增依赖，资源白名单审计未放宽。

## 新实际包真实云复验

使用 OpenRouter `dots-studio/dots-3-note-preview:free`，当轮公开目录核实输入输出零标价，未切换收费模型。测试仅发送原创短样稿，按正式 UI 预览范围、模型、计费提示及输出预算后确认。报告绑定实际 EXE、ASAR 和运行版本 1.3.7，原始材料为 `real-cloud-fixes-report.json`、`real-cloud-fixes.log` 和两张操作截图。

| 原失败 | 本轮实际结果 |
| --- | --- |
| 单句润色 | 通过；单行候选精确替换首句，其余正文保持；确认前不改稿，确认后生成保护快照，重载持久化一致；耗时 16.292 秒（含 UI 步骤） |
| 剧情感受 | 通过；预览与发送预算 8192 token，完整返回两条建议；两处证据核对、零未验证证据、可定位原文；正文与快照不变；耗时 14.664 秒（含 UI 步骤） |

实测每项各一次 prepare IPC、一次 execute IPC、一次 OpenRouter HTTPS POST；冻结授权 token/hash 与预览一致，无自动重发。诊断只透传包装真实主进程 handler 和 HTTPS request，未修改包文件，不收集请求头、请求体或 Key。报告中的候选来自生产解析后的 IPC 返回，不宣称保留未经解析的厂商响应；没有取得完整账户账单，零标价不等于已核对账单。

剧情建议识别了“昨天刚满二十二岁”和“十年前二十二岁”的年龄矛盾，并指出素材没有实际写出犹豫拆信的铺垫；同时给出上下文局限。该单次样本证明原失败链路可完成，不代表文学评价或免费模型长期稳定性已获保证。

诊断包装已恢复，隔离进程树已回收，两类调试端口均关闭，临时作品与配置副本已删除，日常云配置哈希不变。关停记录中的 259 是回收前仍在运行的 Windows 状态，不是正常退出码。云复验和桌面测试均未切换用户输入桌面。

## 最新入口与剩余门禁

| 文件 | SHA-256 |
| --- | --- |
| `release/current/RainSoul Setup 1.3.7.exe` | `61ba50084a98628195e8dde24071a3155d295bde572074e65d58dde807d1042b` |
| `release/current/win-unpacked/RainSoul.exe` | `890a20b321ab7606eb0e503bbde9e3317b8f9287875951afb3dc74ee2ff993b7` |
| `win-unpacked/resources/app.asar` | `4ab2ba368c72adb323d8ff2b1e910a60a812ea14ea92ee79c00e4ad636a8d239` |

安装器 151,164,519 字节，签名 `NotSigned`，证据 `installer-authenticode.json`。已验证发布目录边界与链接、确认无旧包运行进程，再替换 `release/current`，复核新包哈希后物理删除旧 1.3.6 安装器及目录包。`release` 仅保留 current，其中只有上述两个 EXE；不保留旧 EXE 副本。审计材料归档到 `.artifacts/archive/release-evidence-20261019-137/`，清理台账为 `release-cleanup-137.json`，没有删除真实作品、日常安装或凭据，也未推送远端。

本轮仅复验两项失败，不能把旧版其余五项云通过改标到 1.3.7。`release-evidence.pending.json` 如实记录新版两项通过、五项未重验；Windows 10/11 十四格仍 pending。新版 `windows-matrix.pending.json` 已绑定安装器哈希，`release-gate.mjs` 退出 2（blocked），不把修复成功等同最终发布门禁全部放行。Windows 仍需可管理的独立来宾或无作者数据的专用测试机。

本轮没有重试清理历史两处被自动审批拒绝的临时目录；它们的原始阻断说明保留在 1.3.6 报告。本轮新建的后台测试数据均已按台账清理。

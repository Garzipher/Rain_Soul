# α 阶段：最新修改回归与提交门禁

## 范围与执行条件

- 日期：2026-10-22；工作区 E:/soulrain，main 分支，项目版本 1.3.7。
- 起始 HEAD：aa6254a47cd5d59b582db2d238b5bb7150daf0cf，新增第八卷第十九章教材；最近业务提交 1ff92bd 为当前作品和历史快照的正文净稿导出。
- 结合 tasks/author-journey-review-2026-10-21.md 后续修复台账，检查编辑器同步、学习注释、证据复核、来源折叠、书签键盘访问和净稿导出。
- 原有待提交文件：作者旅程台账、asset-navigation.test.tsx、knowledge-long-source.test.tsx、vitest.config.mts。起始状态和补丁已保存于证据目录的 baseline-*，未重置既有修改。
- 主责流程：C:/Users/NO.6/.codex/skills/gstack-qa-only/SKILL.md 的只测不改业务原则，以及项目 .trae/skills/gsd-core、review、requesting-code-review、verification-before-completion。测试表达遵循 C:/Users/NO.6/.codex/rules/tester_style.md。
- 使用现有 Vitest / Playwright / Electron。桌面和浏览器套件在独立非输入 Windows 桌面执行，不切换用户桌面。
- 环境：Windows、Node.js v24.16.0、npm 11.13.0；独立临时数据目录，不读取日常作品或真实服务凭据。
- 证据根目录：.artifacts/tests/alpha-20261022-105615/。证据与临时运行器被现有 .gitignore 排除，不提交数据库、运行配置或二进制导出文件。

## 最新代码与任务核对

1. 净稿参数经过当前作品/快照界面、preload 和严格 IPC 白名单；默认仍为含创作资料模式。
2. 当前和历史导出沿用保存门禁；历史导出读取指定快照冻结数据，不恢复或覆盖当前作品。
3. 两个待提交单测修订对应现有可访问名称和来源折叠；覆盖统计仅增加 evidence-status、knowledge-learning，四项 80% 门槛未下调。
4. 作者旅程台账区分历史发现、后续修复和未覆盖范围，未将自动回归写成真人或真实云验收。
5. 独立子代理只读复核最近业务提交、教材、未提交变更及本轮新增测试；初查未发现阻断，追加截图复核确认一项 P2 来源详情布局问题，随后由真实 Electron 几何探针复现。结果位于 independent-review.md；最终结论以本报告和运行证据为准。

## 本轮测试补充

新增 tests/desktop/manuscript-clean-export.spec.cjs，经真实窗口、预加载和 IPC 验证：

- 当前作品 TXT / DOCX 净稿保留新增正文，隐藏管理书签和资料清单。
- 指定历史快照 TXT / DOCX 净稿保留历史正文，不混入当前新增内容。
- 切回含创作资料后，历史 TXT / DOCX 保留引用及伏笔清单。
- 历史导出前后当前作品和快照列表完全一致。
- 六份实际文件和历史净稿界面截图留在测试输出目录；临时数据库及本轮进程由隔离运行器清理。

## 实际验证结果

| 验证项 | 本轮状态 | 证据 |
| --- | --- | --- |
| 类型检查 | 通过，退出码 0 | typecheck.log、typecheck.exit |
| Lint | 最终全部相关代码检查通过，退出码 0 | lint-delivery.log、lint-delivery.exit |
| 生产构建 | 通过，退出码 0 | build.log、build.exit |
| 原型/浏览器回归 | 74 项通过，退出码 0 | demo-suite.log、demo-suite-status.json、demo.exit |
| 新增净稿桌面回归 | 1 项通过，退出码 0；六份文件实际核对 | clean-export-suite.log、clean-export-suite-output/、clean-export.exit |
| AI 保护专项复验 | 5 项通过，退出码 0 | ai-protection-recheck.log、ai-protection-recheck.exit |
| 完整覆盖率首轮 | 189 文件中 188 通过、1 失败；1697 项中 1695 通过、2 超时，退出码 1 | coverage.log、coverage.exit |
| 完整覆盖率串行复验 | 189 文件、1697 项全部通过，退出码 0；耗时 630.33 秒 | coverage-serial.log、coverage-serial.exit、coverage-serial-summary.json |
| 完整桌面首轮 | 34 通过、1 失败、2 条件跳过，退出码 1 | desktop-suite.log、desktop.exit |
| 搜索性能首轮 | 200 样本，P95 321.20ms，满足现有不超过 1000ms 门槛 | desktop-suite.log、desktop-suite-output/ |
| 完整桌面最终复验 | 35 通过、2 条件跳过、0 失败，退出码 0；耗时 13.8 分钟 | desktop-final-suite.log、desktop-final.exit |
| 搜索性能最终复验 | 200 样本，P95 495.30ms，满足现有不超过 1000ms 门槛 | desktop-final-suite.log、desktop-final-suite-output/ |
| 来源详情布局追加验收 | 1 项失败；两种视口均复现长哈希越界，退出码 1 | source-layout-suite.log、source-layout.exit、source-layout-suite-output/ |

覆盖率首轮出现“关闭工具后再次打开仍保留候选和对比状态”“离开写作到知识库再返回保留候选，重新打开其他作品不能串候选”两项 10000ms 超时失败。单独同文件五项通过后，保持用例、超时和覆盖阈值不变，再完整串行复跑全部 1697 项通过。首轮日志保留；本轮未复现超时，但没有确认其根因，不将其直接归因为机器负载，也不以定向复验替代完整验证。

本轮配置统计范围内覆盖率：语句 92.59%（8214/8871）、分支 87.86%（5627/6404）、函数 94.79%（1548/1633）、行 97.55%（5298/5431），四项均满足现有 80% 全局门槛；不将此统计外推为整个仓库所有代码的覆盖率。

桌面首轮 p1-workflow 拆书用例仍期待默认卡片包含 SHA-256，而近期实现已将哈希按需折叠。真实失败上下文显示简洁出处正常、存在“来源校验详情”。本轮仅更新测试：先验证默认无哈希，以 Enter 展开后验证文件及段落哈希，再收起并验证隐藏；保留真实导入、快照、重启和窄屏断言，未修改业务实现。

该桌面断言调整已获追加独立审查，未发现阻断问题。两个跳过项为无模型研究包和含模型包的指定可执行文件专项；本轮使用开发态 Electron，未提供其安装包路径，不能把跳过写成通过。首轮桌面状态报告确认已停止自身进程、没有切换输入桌面且本轮临时业务数据已清理；证据产物保留。

## 新发现：P2 来源校验详情的完整哈希越出知识卡

- 环境：本轮生产构建的真实 Electron，断网；独立临时作品、两条合成知识和系统格式的 64 位 SHA-256 来源，没有替换组件、注入 CSS 或修改业务实现。
- 复现：打开作品知识库，展开知识，再用 Enter 展开“来源校验详情”；分别在默认窗口和 720×540 窗口检查长哈希。
- 预期：文件及段落哈希可完整阅读，长串在所属知识卡内换行，不越过卡片边界或迫使结果区横向滚动。
- 实际：默认 renderer 视口 1264px 时，卡片右界 906px，哈希文字右界 1030.95px，越界约 124.95px；720×540 窗口的 renderer 视口为 704px，卡片右界 679px，文字右界 809.45px，越界约 130.45px。两类哈希均复现。
- DOM 度量：正文段落 clientWidth 为 267/268px、scrollWidth 均为 425px；计算样式为 white-space: pre-wrap、overflow-wrap: normal、word-break: normal。使用真实文本 Range 的边界断言失败，不是仅凭截图猜测。
- 代码定位：src/renderer/components/knowledge-source-audit.tsx 的 KnowledgeSourceVerification 使用 p.bookmark-fulltext；inline-bookmark.css 仅给其 pre-wrap，没有长串断行规则。.knowledge-source 的 overflow-wrap:anywhere 不会传给其兄弟详情节点。独立审查将相关路径追溯到近期 0410c48、86fbe27。
- 影响与等级：P2/中；校验信息阅读布局异常。未发现数据损坏、导出内容错误或正文保存失败，不扩大为主流程不可用。
- 证据：source-layout-suite-output/source-layout-probe-来源校验详情展开后两类完整哈希应保持在知识卡边界内/ 中保存 source-layout-geometry.json、两个窗口截图、trace.zip、error-context.md；完整日志为 source-layout-suite.log。独立复核见 independent-review.md 第七节。
- 建议修复方向：为实际承载完整出处的详情文本补充长串换行规则，并把展开状态加入桌面布局回归；测试任务不擅自修改业务 CSS。

既有套件未覆盖此展开状态的几何边界，因此“既有套件通过”和“追加布局验收失败”同时成立；不能据此宣称本次修改完全无误或 α 发布验收通过。

## 隔离、清理与证据

demo、clean-export、desktop、desktop-final、source-layout 五次隔离运行的状态报告均为 stopped、distinctFromInput=true、switched=false、testDataCleaned=true。本轮真实临时业务目录已清理，自身桌面进程已回收；截图、导出文件、日志和诊断脚本继续作为证据保留。未清理历史明确保留或归属不明的数据。

收尾重新比较 509 个源代码、测试及配置输入的 SHA-256，与执行前指纹一致，无未验证的代码漂移；见 validation-inputs.json、validation-inputs-final.json。git diff --check 通过，暂存区为空，HEAD 仍为 aa6254a；没有创建提交。

## 提交与边界

本轮完整验证与追加布局验收已结束。因确认一项尚未修复的 P2 布局缺陷，不满足用户“确认无误后提交”的条件，未暂存、未创建 commit。起始四文件和本轮测试/报告修改均保留在工作区，不重置用户修改；待业务修复和布局回归通过后再决定提交。

本轮未修改业务实现、未调用真实云模型、未生成或安装安装器、未推送远端。未执行的发布验收不记为通过。历史明确保留或归属不明的数据不纳入本轮清理。

## 2026-10-26 后续全量复验

本节承接上述历史记录，不修改 10 月 22 日首轮失败及当时未提交的事实。来源详情越界已在后续提交 23b0255 修复，Red/Green 及单项证据见 tasks/source-layout-fix-2026-10-22.md；本次重新验证修复后的完整代码。

- 起始基线：main，23b0255beb6152af3489f58217ec10b5571e5936，项目版本 1.3.7。
- 用户范围：后台完整测试，确认没有问题后提交；不推送、不重新打包 EXE。
- 开始时间：2026-10-26 11:10:54（+08:00）。
- 新证据目录：.artifacts/tests/author-opt-final-20261026/。起始分支、差异和 516 个源码、测试及配置输入指纹已留档。
- 顺序：类型检查 → Lint → 生产构建 → 完整覆盖率 → 浏览器 → 桌面。覆盖率使用 --pool=forks --maxWorkers=1，测试超时及四项 80% 门槛不变。
- 桌面和浏览器复用已有独立非输入桌面运行器，不切换用户桌面，使用隔离临时数据。实际停止与清理结果以本节最终状态及原始状态文件为准。
- 独立只读审查已完成，无阻断问题；审查证据 independent-review.md 不代替本轮运行结果。

执行结束：2026-10-26 11:41:04（+08:00）。本轮流水线全部阶段退出码为 0，未出现测试失败。

| 验证项 | 10 月 26 日实际结果 | 新证据目录内文件 |
| --- | --- | --- |
| 类型检查 | 通过，退出码 0 | typecheck.log、typecheck.exit |
| Lint | 通过，退出码 0，无警告 | lint.log、lint.exit |
| 生产构建 | 通过，退出码 0，日志无构建警告 | build.log、build.exit |
| 完整覆盖率 | 189 文件、1697 项全部通过，639.89 秒 | coverage.log、coverage.exit、coverage-summary.json |
| 浏览器回归 | 74 项通过，1.7 分钟 | demo-suite.log、demo.exit、demo-suite-status.json |
| 完整桌面回归 | 36 项通过、2 项条件跳过、0 失败，14.3 分钟 | desktop-suite.log、desktop.exit、desktop-suite-status.json |
| 搜索性能 | 200 正式样本，nearest-rank 第 190 个，P95 341.40ms ≤ 1000ms；20 次预热另计 | desktop-suite.log、desktop-suite-output/ 内性能报告 |
| 独立只读代码审查 | 无阻断，Critical / Important / Minor 均为 0 | independent-review.md |

配置统计范围内覆盖率保持：语句 92.59%（8214/8871）、分支 87.86%（5627/6404）、函数 94.79%（1548/1633）、行 97.55%（5298/5431）。四项均超过既有 80% 门槛，不外推为全仓库覆盖率。

### 重点核对与清理

- 净稿桌面用例进入完整套件，实际读取当前净稿、历史净稿、历史完整稿各 TXT/DOCX 六份文件，保护当前正文及快照身份；文件和截图保存在 desktop-suite-output/。
- 来源详情布局用例进入完整套件。默认实际视口 1264px：卡片/详情可视宽度与滚动宽度分别为 307/307、267/267；窄视口 704px：对应为 296/296、268/268。两个窗口中的完整哈希均换为两行，无横向越界，几何记录见 source-layout-geometry.json。
- 浏览器与桌面状态文件均为 stopped、exitCode=0、distinctFromInput=true、switched=false、testDataCleaned=true。本轮创建的临时业务目录及自身进程已回收；原始日志、截图、导出和运行器保留为证据。
- 比较执行前后 516 个源码、测试及配置文件的 SHA-256，unchanged=true；文档台账更新不计入代码输入。见 validation-inputs.json、validation-inputs-final.json。
- git diff --check 通过。七个拟提交文件未发现 OpenRouter Key 或私钥特征；五个测试/配置文件暂存后再次检查范围与凭据特征。这里只陈述所用特征扫描，不宣称完成全仓库安全审计。
- 证据目录、运行器、临时配置和发布二进制仍被现有 .gitignore 排除，未纳入提交。

### 提交与保留边界

本轮完整源码回归及提交前审查未发现阻断，测试/配置五文件已独立提交为 1d607cd（test(authoring): 完善创作优化的回归覆盖）。原有业务修复保持不变；本记录与作者旅程台账按文档变更独立收尾。

两项跳过仍为指定无模型研究包和含模型包的 EXE 专项，本轮未提供对应包路径，不能记为通过。真实云模型联调、干净 Windows 安装/升级/卸载矩阵、长篇连续真人写作没有在本轮执行；这些发布验收仍待完成，不能据本轮源码回归宣称产品发布门禁全部通过。本轮未重新打包或替换 EXE、未安装程序、未推送远端。

已执行 compound-engineering 耐久性检查：无需新增知识条目。该轮主要为既有修复的完整验证，隔离运行方法、断言边界及失败历史均可从既有记录、测试与本节直接恢复。

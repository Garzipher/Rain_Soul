# 来源校验详情长哈希换行修复记录

- 日期：2026-10-22（Asia/Shanghai）。
- 被测基线：aa6254a47cd5d59b582db2d238b5bb7150daf0cf，加本轮最小 CSS 修复。
- 用户范围：修复该项后只针对该项回归，无异常后提交；本轮未重跑全量测试。
- 环境：Windows、真实 Electron；在独立非输入桌面后台执行，未切换用户桌面。
- 主责审查技能：E:/soulrain/.trae/skills/review/SKILL.md，含审查清单。
- 流程依据：项目 test-driven-development、verification-before-completion 技能及 tester_style.md。

## 问题与修复

路径：知识库 → 作品知识库 → 展开知识卡 → 来源校验详情。完整 64 位文件和段落 SHA-256 在卡片内不断行，越出卡片边界。

根因：.bookmark-fulltext 保留空白及换行，但没有长字符串断行规则；兄弟节点 .knowledge-source 的断行样式不能继承到详情段落。

仅为 src/renderer/components/inline-bookmark.css 的 .bookmark-fulltext 增加 overflow-wrap: anywhere，保留原 white-space: pre-wrap 与行高，不修改原始哈希或存储内容。共享该类的书签详情允许长串换行。

新增 tests/desktop/knowledge-source-layout.spec.cjs，验证默认折叠、Enter 展开和收起、两条完整哈希以及两个窗口的真实文字边界和滚动宽度。使用 DOM Range 测量文字，避免只测容器而漏掉原缺陷。

## 本轮验证

| 检查 | 结果 |
| --- | --- |
| 修复前单项回归（Red） | 1 项失败，命中完整哈希越界断言；文字右界 1030.953125，卡片右界 906 |
| 修复后单项回归（Green） | 1/1 通过，21.6 秒，退出码 0 |
| npm run build | 通过，退出码 0，构建日志无警告 |
| 新增测试文件定向 ESLint | 复查通过，退出码 0；初次 no-undef 已改为 window.getComputedStyle |
| 独立代码审查 | 无新的阻断项；已复核共享样式影响、断言、日志及截图 |

Green 运行时间：2026-10-22 11:57:08 至 11:57:31（+08:00）。日志的 NO_COLOR/FORCE_COLOR 提示仅涉及终端颜色。

| 窗口 | 卡片可视/滚动宽度 | 详情可视/滚动宽度 | 哈希最右位置 / 卡片右界 |
| --- | --- | --- | --- |
| 默认，实际视口宽 1264 | 307 / 307 | 267 / 267 | 882.484375 / 906 |
| 原生 720×540，实际视口宽 704 | 296 / 296 | 268 / 268 | 660.984375 / 679 |

两个窗口下，两条完整哈希各自折成两行，无横向越界；实际计算样式保留 pre-wrap。默认及窄窗口截图已目视核对。

## 数据与证据

- 本轮独立临时作品：test α来源布局核验；知识卡：test 来源布局甲、test 来源布局乙。
- 通过应用 API 创建夹具并重启后从真实 UI 打开；哈希为 SHA-256(test α来源布局夹具)，文件和段落各使用完整 64 位值。
- 仅使用本轮临时数据目录；本轮数据已清理，测试进程已退出。未访问日常作品或真实云凭据。
- Red/Green 状态均为 stopped、distinctFromInput=true、switched=false、testDataCleaned=true。
- 证据根目录：E:/soulrain/.artifacts/tests/source-layout-fix-20261022-115454/。
- 原始证据：red-suite.log、green-suite.log、两份 suite-status.json、build.log、lint-target-recheck.log、independent-review.md。
- 截图及几何：green-suite-output/ 下的 source-layout-default.png、source-layout-720.png、source-layout-geometry.json。
- 隔离运行器、临时数据、二进制及原始证据均不纳入 Git。

## 提交边界与知识检查

本次仅提交上述 CSS、单项桌面回归和本记录。此前其他 7 个待提交文件保持原样，不混入本次提交，不推送远端。

已按 compound-engineering 检查耐久性：无需额外沉淀。该常规 CSS 修复的原因、预防断言和验证事实已可从最终代码、测试及本记录直接恢复。

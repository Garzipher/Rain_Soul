# 知识库入口与交付目录整理

日期：2026-10-14。目标版本1.3.2，分支`codex/cloud-local-semantic`。

## 作者反馈与根因

- 实读`release/current/win-unpacked/resources/app.asar`内package.json为1.1.0；上轮`release/ghost-reference-20261014`为1.3.1。当前目录没有随交付更新，导致作者容易打开历史程序。
- 最新App在`work=null`时也把知识库渲染成“开发中”。知识按作品保存，缺少作品上下文应解释如何选择，而不是声称功能未交付。
- `tests/`有204个受控文件，包含自动化用例、夹具和适配器；应保留。报告和日志已有忽略规则，但75个历史`.playwright-mcp`记录此前已被跟踪，新增ignore不能使其自动退库。

## 修复与目录

- 最小替换知识库未选作品分支，显示“请先选择作品”、知识归属说明与返回作品集按钮。走原有navigate/guarded/保存门禁；未自动打开作者作品，已选作品的加载/重试分支不变。
- 停止跟踪75个历史浏览器生成文件，保留本地内容；按每组小于500行分12个原子提交。补`.playwright-mcp/`、`.artifacts/`及根目录`.p0-*`目录忽略规则。
- 默认桌面输出`.artifacts/tests/desktop`，Demo输出`.artifacts/tests/demo`，HTML报告`.artifacts/reports/demo`，覆盖率`.artifacts/coverage`。`npm run test:report`指向新报告位置；阈值未变。
- 263个根目录日志或结果目录移入`.artifacts/archive/root-20261014/`，原名保留，未删除证据。搬迁清单`.artifacts/manifests/root-archive-20261014.json`，已核对原路径全部移走。
- `release`收敛为`current`和`archive`。1.1.0旧current归档为`release/archive/current-1.1.0-20261014`；其他历史目录保留原名移至archive。曾将已验证1.3.1临时提升到current，新修复包验证后再更新current。清单`.artifacts/manifests/release-archive-20261014.json`。
- 所有目录移动前核对工作区绝对边界、顶层链接、目标不覆盖；release移动前核对无运行实例及1.3.1原ASAR摘要。作者作品和Key保存在仓库外，本次不迁移、不删除。

## 规格说明与审查

这是反馈修正和生成物整理，使用systematic-debugging、TDD、GSD Core、review、verification-before-completion；未重新启动已确认的产品设计。独立review两遍未发现High/Medium，唯一README默认报告目录过期提示已修正。

“隔离资格”不是外部证书、账号或需要作者申请的许可；是项目对网页脚本访问能力的验收。受控Chromium夹具已通过部分机制检查，仍缺系统出站观测、旁路反例和固定正式包证据，生产能力仍禁用。普通公开网页抓取、粘贴/文件拆书、云会话、BGE检索与此分别验收；不把禁用动态渲染解释为全部AI不可用。

## 验证

- TDD红测：未选作品进入知识库时找不到“选择知识库作品”，DOM明确显示旧占位页；红测退出1。
- 修复后两个App相关单元文件12项通过，定向ESLint退出0，日志`.artifacts/logs/knowledge-entry-unit.log`及`knowledge-entry-lint.log`。
- 完整`npm run verify`退出1：TypeScript、ESLint、生产构建和168文件/1564项单元组件通过；桌面首轮30通过、2失败、2实际包专项跳过。失败分别为受限渲染夹具清理门禁和性能窗口被作者最小化；不把整体命令或首轮失败场景记成通过。原始日志`.artifacts/logs/release-layout-verify.log`。
- 单元覆盖率：语句93.39%、分支88.78%、函数95.55%、行98.31%，门槛未变。
- 受限渲染专项复验八夹具通过，仍保留正式能力禁用；该轮搜索再次被最小化中止，不能用少量样本验收。日志`.artifacts/logs/release-layout-recheck.log`；报告在`.artifacts/tests/release-layout-recheck/`对应用例目录。
- 作者确认此前手动最小化并同意保持窗口可见后，独立完整重跑200个搜索样本退出0（1.9分钟）：P95=217.80ms、中位80.50ms、最大455.50ms，无原生窗口隐藏/最小化样本。20次预热与221次准备查询另计；沿用真实输入→正确DOM→双显示帧，1秒门槛未放宽，前两无效轮不并入。日志`.artifacts/logs/release-layout-search-final.log`，报告在`.artifacts/tests/release-layout-search-final/`对应用例目录。
- Demo完整74项通过（1.9分钟），日志`.artifacts/logs/release-layout-demo.log`。
- 1.3.2安装器构建退出0，构建结束后资源白名单审计通过，实际ASAR版本为1.3.2，测试源码/工具/本机证据成员0。日志`.artifacts/logs/release-layout-pack.log`；最终审计`release/current/acceptance/desktop-package-audit.json`。
- 实际新EXE底层BGE验收退出0：100条知识/30个查询、512维、中文语义改写召回86.67%、关键词改写66.67%、冷加载814.36ms、总耗时6223.16ms，受监测联网入口调用0次。报告`.artifacts/tests/release-layout-package/model-acceptance.json`，日志`.artifacts/logs/release-layout-package-model.log`。开发者预置标注及API入口拦截不等于独立文学质量评估或全系统抓包。
- 实际新EXE四项UI专项全部通过（37.6秒）：未选作品知识库入口及跨作品复制、灰字接受/撤销/AI暂停、教材45章28图和重启保留旧数据、模型启用/检索/停用回退和重启。日志`.artifacts/logs/release-layout-package-ui.log`，截图与trace目录`.artifacts/tests/release-layout-package-ui/`。未将目录包运行等同于NSIS安装矩阵。
- 1.3.1旧current移至`release/archive/ghost-reference-20261014`，新包由候选目录提升为`release/current`；移动前核对release无运行进程、路径边界/链接及目标不存在，移动后ASAR摘要均不变。清单`.artifacts/manifests/current-promotion-1.3.2-20261014.json`。包验收报告保留当时候选目录身份，按清单映射到current。

## 当前产物与未完成门禁

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `release/current/RainSoul Setup 1.3.2.exe` | 149372121 | `f4b4711edb8a2a1cf64c76723c7a032830f4da3d9697c5380e785d5eab3c8f40` |
| `release/current/win-unpacked/RainSoul.exe` | 246302720 | `c4b4400ea8a0f7283196acdd7bd6f90c455473022d2b4b6d010da864964a0bce` |
| `release/current/win-unpacked/resources/app.asar` | 68016683 | `2e63df7b99a132d4601f7bdbeacf57d1169b811e442d8f76ee919a07feb1ab53` |

安装器签名状态`NotSigned`。目录包分享须保留整个win-unpacked；安装器分享不包含作者配置或密钥。干净Windows10/11安装、原位升级、卸载矩阵、其余真实云操作及本轮包云兼容/计费、其他Word版本、受限渲染正式系统网络/实际包资格仍待验。本轮没有追加真实云请求。

知识复利复核：旧EXE与单实例锁、ignore不自动退库及证据归档映射等原因已写入教材和本记录，耐久性信息可从项目文档恢复，不重复创建同内容知识条目。

## 历史证据路径映射

旧文档或原始报告记录的是当时的真实运行路径，不改写其历史身份：根目录`test-results*`、覆盖率、`.p0-*.log`等前加`.artifacts/archive/root-20261014/`；旧`release/<名称>`前缀替换为`release/archive/<名称>`，其中旧current使用上表版本化名称。1.3.1经历提升和后续归档，实际最终位置在下方产物记录补充。

此前被自动审批拒绝删除的Temp目录仍按上轮台账保留。本轮没有换方式删除那些被拒绝的目录，也没有批量删除未知临时目录。模型研究资料`.tmp-model-qualification`仍供资格工具复现实验使用，未移动。

本轮实际EXE底层模型验收产生的隔离档案`%TEMP%/rainsoul-packaged-model-UXJ2d6`尚保留。尝试按报告身份、Temp边界、链接和运行进程检查后递归清理，自动审批拒绝命令，返回`blocked by policy`且没有更具体原因；未换工具重试，未生成成功清理清单。四项UI用例按既有finally清理隔离作品，原始证据继续保留。

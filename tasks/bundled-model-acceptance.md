# 内置模型实际包验收记录

日期：2026-10-13。状态：显式无模型研究目录包已生成，实际 EXE 定向验收 1 项通过（15.8 秒）；模型资格尚未通过。

本轮仓库可信来源锚尚未取得，五资格保持 false。正式默认捆绑构建应失败；只允许显式无模型研究包进入本次实际 EXE 验收。无模型包不能证明真实模型冷加载、性能、质量或模型网络行为通过。

## 构建与资源顺序

统一串行执行 build 后，研究包使用 `node scripts/pack-desktop.mjs --without-bundled-model`。脚本生成独立 `release/research-without-model/<UUID>` 目录，并输出未捆绑说明，不覆盖 release/current。

当前 Vite 的 outDir 是 dist/renderer，emptyOutDir 只清理该子目录；desktop 脚本写 dist/desktop。因此 npm pack 先构建不会清理同级 dist/retrieval-model。正式流程仍建议 build → prepare → node pack，避免未来输出规则改变和并行构建竞争，资源目录保持原设计。正式 prepare 和 pack 不接收外部可信锚参数；来源缺失不得使用伪造材料或环境变量放行。

## 执行命令

构建由主协调者统一完成后才打包。PowerShell 中指定新研究包实际 EXE：

```powershell
$env:RAINSOUL_TEST_EXECUTABLE = 'E:\soulrain\release\research-without-model\03cd3b17-c92c-4abb-b36a-327785535dc8\win-unpacked\RainSoul.exe'
npx playwright test --config playwright.desktop.config.cjs tests/desktop/bundled-model.spec.cjs
$testExit = $LASTEXITCODE
Remove-Item Env:RAINSOUL_TEST_EXECUTABLE
exit $testExit
```

测试只创建临时作者资料和原创夹具，记录实际 EXE/ASAR SHA-256、Electron 版本、安装资源路径、完整运行指纹、来源与偏好；验证 resources 和 ASAR 没有模型权重、真实 IPC 关键词/混合/语义回退、停用跨启动保持、写作保存重启读回。没有指定 EXE 时跳过，不把开发入口结果冒充实际包证据。

报告和设置截图已持久保存于 `release/research-without-model/03cd3b17-c92c-4abb-b36a-327785535dc8/acceptance/`，文件分别为 bundled-model-research-report.json 和 bundled-model-absent-disabled.png。报告时间为 2026-10-13T04:00:59.869Z。Playwright 渲染上下文 offline 仅证明该上下文断网运行；不能代替系统网络观测或主进程零出站证明。

## 本轮实际结果

打包命令退出码为 0，产物为 win-unpacked 目录包，未生成安装器。以下 SHA-256 由实际文件流式计算；报告同时保存实际 app.isPackaged、执行路径、资源路径、版本和完整模型预期指纹。打包日志中的重复依赖引用提示未阻断构建；Playwright 的 NO_COLOR/FORCE_COLOR 提示仅影响终端着色。

| 项目 | 状态或证据 |
| --- | --- |
| 实际 EXE 绝对路径 | E:\soulrain\release\research-without-model\03cd3b17-c92c-4abb-b36a-327785535dc8\win-unpacked\RainSoul.exe |
| EXE 大小 / SHA-256 | 246302720 字节；c55c5f98e475d48eb3b7cc9030ad8285ad702d883185a05ce6a5d13c94ce7618 |
| 实际 ASAR 大小 / SHA-256 | 67699666 字节；b51cf23ded992709a800647613936a7a213e2dad6f89e1efaf43f381e34df29f |
| 实际包身份 | app.isPackaged=true；RainSoul 1.3.0；Electron 44.7.0；执行路径与指定 EXE 一致 |
| resources、ASAR 无权重 | 通过：resources/retrieval-model 不存在；ASAR 无 dist/retrieval-model 权重条目 |
| 关键词与语义回退真实 IPC | 通过：keyword 返回 ready；hybrid/semantic 返回 fallback；命中关键词、modelFingerprint=null；无 RetrievalCache 目录 |
| 停用偏好跨启动保持 | 通过：来源始终 bundled；enabled 从 true 改为 false，重启后保持 false；bundledPresent/installed/qualified 均 false |
| 写作保存与重启读回 | 通过：原创作品、章节标题“离线写作保持”和正文重启后完整读回 |
| 固定官方来源与转换 revision | 待证据，阻断正式捆绑 |
| 系统观测零出站 | 未执行 |
| 模型加载 ≤30秒 / RSS 增量 ≤1.5GiB | 无模型包不适用，真实模型待验 |
| 千条索引 / 200查询 P95 ≤1秒 | 待当前指纹实际包实测 |
| 独立人工质量校准和复核 | 未完成 |
| 干净 Windows 安装、升级、卸载 | 未执行 |

## 旧资格命令核查

qualify-retrieval-model.mjs 固定读取 .tmp-model-qualification/model，使用旧研究依赖及手工清单；`--production` 读取源码 dist/desktop 的适配器，不接收实际 EXE 路径。报告已有明确“非生产包/干净系统验收”限制，不能当作本轮实际包或内置来源资格证明。

qualify-retrieval-performance.mjs 从源码编译研究 helper，读取同一研究目录权重与质量夹具，使用源码 dist Worker 和隔离数据库，记录开发者预标注质量与合成短知识性能。它不修改产品资格，但也不校验当前实际 EXE 身份。旧结果不能直接复用为本轮正式资格放行；来源允许后需把实际包、资源 hash、系统网络证据和独立质量集身份全部绑定到当前指纹重新验收。

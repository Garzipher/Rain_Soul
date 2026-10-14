# 灰字参考、正文等待与本机聊天模型交付

## 已批准范围

作者已确认本机知识原句灰字、与AI工具互斥、隔离渲染正文等待及Qwen3 CPU研究。实现没有新增数据库字段：未接受的灰字仅为DOM装饰；Tab接受后按既有正文保存流程落盘。云服务不因本轮改动自动发送、切换或重试。

## 实现与评审

- 400ms输入停顿，当前作品知识句首前缀匹配；中文至少2字符、纯ASCII至少3字符，扫描最多20万字符、余句最多160个Unicode字符。出处可见；Tab接受前核对段落/知识版本，Esc抑制当前位置，IME组合时不触发。
- 选区、光标、失焦、右键、锁定和知识刷新使候选失效。AI工具打开、生成、授权待确认或候选待审期间暂停；关闭面板并保留候选时仍暂停。
- 接受前后关闭撤销历史组，不连带撤销前缀；空候选不重复排队。两项Medium初审发现均已按TDD修复，二审无剩余High/Medium，详见同目录审查记录。
- AI续写沿用真实授权上下文、大纲、伏笔、写作特点和参考知识，提示生成自然衔接的新内容；提示不能保证模型文学质量。原句补全不判断剧情适用性，作者自行决定是否接受。
- 正文出现/稳定轮询共享额外5秒及整任务40秒期限，750ms稳定后最终复核网络及最新正文。生产解析继续隔离Worker；正式受限渲染仍禁用，真实夹具不替代系统网络和固定实际包资格。
- Qwen3两种规模均独立CPU实测，0.6B文学质量不足；1.7B速度约2.82～3.24 token/s、峰值工作集约2.02GB，当前8GB主机不建议默认内置。完整参数、输出问题与边界见模型评估报告。
- BGE-small按固定revision、许可与hash随包分发；接收者无需维护者Key。配置在仓库外safeStorage/DPAPI加密保存；ignore、归档白名单及包审计排除凭据。常见token格式扫描无发现，不证明未知格式秘密不存在；聊天已暴露的Key仍须服务商撤销。

## 验证记录

- 完整 `npm run test:coverage` 退出0：165文件、1541项通过，649.22秒。语句93.39%、分支88.78%、函数95.55%、行98.31%，日志 `.p0-ghost-full-coverage.log`。
- `npm run typecheck`、`npm run lint` 退出0；桌面预构建成功。三项灰字单元/组件文件18项复验通过。
- 首轮完整桌面30通过、2失败、2实际包专项跳过：灰字测试过早导航；性能P95=1977.8ms，慢样本约1.8秒为双帧等待，结果DOM通常50～210ms。失败证据保留 `.p0-ghost-desktop.log`。
- 灰字用例等待知识表单关闭、并真实移动光标后复验1/1通过，15秒，日志 `.p0-ghost-target2.log`。
- 性能测试窗置顶并逐次回到前台，不移除双帧测量、不放宽1秒门槛；后续复验与完整回归另补结果。
- 置顶专项未跑完时仍观察到帧节流，核对本轮PID11768后仅停止该测试树；未把中止轮计成通过。最终性能窗另加 `--disable-features=CalculateNativeWinOcclusion`，记录实际测量环境，正式程序启动参数不变。
- 提交前再次扫描1375个tracked/待提交文件，未发现常见OpenRouter/Hugging Face token格式；10项ignore与示例模板保留检查通过，不扩大为未知格式秘密不存在。
- 第二轮完整桌面29通过、3失败、2实际包专项跳过（22.6分钟）：灰字关闭AI后测试假设Home会移动光标，实际offset仍2；资格脚本180秒超时被临时档案EBUSY掩盖；性能P95=2173.10ms。完整失败日志和trace保留，不计通过。
- 灰字测试等待对话框关闭及正文焦点，再用ArrowLeft/ArrowRight逐步核对DOM与ProseMirror真实光标，专项1/1通过（19.6秒）；新样式构建后再次1/1通过（8.8秒），截图已收入教材。
- 性能JSON显示round0～5全部双帧>1秒、round6～9全部恢复，代码数据未变化。进一步核对Playwright loader发现它覆盖启动参数的disable-features；测试专用预加载改为ready前合并列表，并从实际Electron读取开关验证，逐样本记录窗口/页面可见性与两帧耗时。保留原200样本、双帧终点与1秒门槛。6项TDD红绿回归通过。
- 资格工具改为等待Electron close及Windows taskkill整树close；清理未完成时保留临时档案，原始超时日志不被覆盖。8项TDD回归通过；新增模块覆盖率语句84.61%、分支87.5%、函数100%、行87.87%。独立实际运行时复验8夹具全部通过，见`test-results-render-diagnostic/report.json`；不能追认上一轮超时通过。
- 完整typecheck、lint退出0。教材图片相对路径首次被构建白名单拒绝，已改为既有`images/`批准路径，后续生产构建成功，实际编译45章、28图。
- review清单最终两遍只读复核未发现新增High/Medium。目录有29张图，但实际教材引用并打包28张；README按实际随包数量记录。
- 第三轮在性能测量中发现原生窗口`visible=false/minimized=true`，但DOM仍报告visible/focused，双帧接近1Hz；本轮已核对Playwright PID23228命令与工作区后仅终止该测试树。之前灰字、教材及八个渲染夹具均通过，整轮中止不计完整回归通过。后续测试在每次真实输入前恢复并核对原生窗口，测量中窗口隐藏/最小化则明确判为环境无效，不丢弃慢样本重抽。
- 最新常见Token格式扫描1381文件零命中，6项凭据/环境文件忽略检查及`.env.example`保留检查通过；不扩展为未知格式秘密保证。
- 最终完整覆盖率退出0：168文件、1563项通过，545.92秒，语句93.39%、分支88.78%、函数95.55%、行98.31%，日志`.p0-ghost-coverage-final.log`。74项Demo回归通过（1.8分钟）。新增显示恢复工具经14项定向测试和scoped review通过，没有改变产品显示策略或性能门槛。
- 最终完整typecheck、lint与生产构建退出0。含最新教材的完整桌面回归退出0：32项通过、2项实际包专项跳过（6.5分钟），日志`.p0-ghost-desktop-final-complete.log`；跳过不计通过。
- 完整桌面回归的200个搜索样本P95=201.40ms、median=76.40ms、max=268.70ms，原生窗口环境无效数0；终点仍为真实输入至正确结果DOM再完成两显示帧，门槛仍为P95≤1秒。JSON保存在`test-results-desktop-final-complete/search-performance-百万字-千条知识真实Electron输入至结果渲染200样本P95不超过1秒/search-performance.json`。
- 安装器构建退出0，最终资源审计通过。实际EXE底层模型验收退出0：固定100条知识、30条查询，语义改写召回86.67%、关键词改写召回66.67%，512维、冷加载1114.58ms，总耗时9791.02ms，受监测网络入口调用0次。报告`test-results-ghost-package/model-acceptance.json`；开发者预置相关标注，独立真人标注复核未完成；不扩大为系统抓包或真实文学质量结论。
- 首轮实际包三专项2通过、1失败，灰字在按Tab前已经失效。诊断轮记录：4481ms候选存在、4612ms自动保存回执刷新资产后候选清除、4797ms按Tab时无候选，正文仍聚焦；因此正常Tab转移焦点，没有插入。用例增加保存后及截图后重新确认当前候选可见，不修改产品行为或强制触发候选，失败日志/trace保留在`test-results-ghost-package-ui`及`test-results-ghost-package-diagnostic`。
- 修订后的实际包三专项全部通过（51.2秒），日志`.p0-ghost-package-ui-final.log`：灰字接受/撤销/AI暂停、教材45章与图片加载及重启保留旧数据、BGE启用/重建索引/中文改写检索/停用回退及重启。UI模型报告与截图位于`test-results-ghost-package-ui-final`。没有把目录包启动等同于NSIS安装。
- 最终灰字用例加入诊断失败也执行清理的finally保护，实际EXE再次1/1通过（8.8秒），日志`.p0-ghost-package-ghost-final.log`。新增用例通过ESLint和diff检查；review清单两遍范围复核无新增High/Medium。改动仅为验收同步及受控样稿诊断，没有改动已打包产品代码。
- 收尾扫描1383个tracked/待提交文件，常见OpenRouter/Hugging Face Token格式零命中；最终审计模式`formal-bundled`，ASAR摘要与实际模型验收报告一致。不据此推断聊天中暴露的旧Key已经撤销。

## 测试数据清理台账

正常桌面用例在finally清理隔离作品与档案；原始日志、trace、覆盖率和模型报告按证据保留。第二轮失败的临时浏览器目录`%TEMP%/rainsoul-render-qualification-jHj0Et`归属本轮，已有失败trace。手动清理命令被自动审批以`blocked by policy`拒绝，未给出更具体原因，尚未清除；没有尝试绕过拒绝或扩大删除范围。模型研究文件作为复现实验资料保留在忽略目录。

最终实际EXE底层模型验收目录为`%TEMP%/rainsoul-packaged-model-vyhrnR`，内容为本轮隔离档案；底层报告已保留。其带路径边界/链接/进程核查的PowerShell递归清理同样被自动审批以`blocked by policy`拒绝，没有提供更具体原因，目录仍保留，未换工具绕过。UI三专项的隔离作品按既有finally清理，不接触作者数据。

第三轮中止可能另留搜索验收隔离目录，尚未定位，未批量删除历史Temp目录。无法确认归属的目录不计作已清理。

## 最终包与未完成门禁

本轮版本1.3.1，正式含BGE的安装器已构建并完成上述实际目录包验收；此前1.3.0不能当作本轮交付。构建日志中重复依赖引用为builder归并提示，最终ASAR/旁树白名单审计通过；Vite插件耗时提示及Playwright的NO_COLOR/FORCE_COLOR提示已评估，不影响产物或断言。

| 产物 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `release/ghost-reference-20261014/RainSoul Setup 1.3.1.exe` | 149369739 | `9c8822a2be6247c9a820193e92f0d3075621288e92fdde5990b71654fc2b46ac` |
| `release/ghost-reference-20261014/win-unpacked/RainSoul.exe` | 246302720 | `b71a49ed393df5ce5d04314c38e117fa13330cee62eb1a8e170c2250eecf4818` |
| `release/ghost-reference-20261014/win-unpacked/resources/app.asar` | 68009875 | `b087cc838e2807a01dfd0bb3159140298463d058e3e81b5584553cb0a49317d1` |

安装器Authenticode状态`NotSigned`；`acceptance/desktop-package-audit.json`为构建后最终审计。分享安装器保留内含第三方许可即可，不附个人配置或Key。若直接运行目录包，须保留整个`win-unpacked`，先退出旧实例。

干净Windows10/11安装、升级、卸载，其余P0真实云操作与本轮包云复验、其它Word版本、正式受限渲染系统网络/实际包资格仍待验。本机模型研究不等于正式聊天模型集成，也不保证长篇一致性。

知识复利复核：撤销分组与空事务循环的原因已进入新增教材章和评审报告，耐久性信息已可从项目文档恢复，因此不重复创建同内容知识条目。

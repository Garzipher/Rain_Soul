# 内置中文语义模型实测

日期：2026-10-13。采用用户批准的固定公开来源、许可与文件校验政策，不要求精确转换链证明。官方原站交叉与转换证明仍为 false，不能把镜像材料当官方证书。

## 已取得的底层证据

执行 `scripts/accept-packaged-retrieval-model.mjs`，指定 `release/semantic-candidate-20261013-b/win-unpacked/RainSoul.exe`。它实际启动 EXE，在主进程创建隔离推理 Worker，读取包内 ASAR 生产运行库、旁树 WASM 与固定权重。临时模型研究目录不参与加载，作品使用隔离目录。

候选 b 的整体构建在 EXE 资源编辑时失败，所以这份证据只证明该目录包的模型运行，不作为最终安装器构建成功。候选 a 同阶段失败；候选 c 在复制第三方声明时 EBUSY，模型不完整，排除出质量验收。失败原因与修复不得从记录中删去。

- 原始报告：`.tmp-model-qualification/packaged-candidate-b2-20261013.json`，包含 EXE、ASAR、WASM、运行库、权重及清单 SHA-256，启动前后身份一致。
- 固定夹具：100 条原创知识、30 个验收查询；夹具 hash 为 `787abac3aaaed9ddd30ca2e49b24da979d504ceecda88dd0e750c8a7789f2c61`。相关 ID 由开发者预标注，未经过独立真人复核。
- 固定阈值 `0.5125038418350374` 来自既有独立校准集，本轮没有用验收查询反调阈值。
- 中文改写 Recall@5：13/15（0.8667），研究二元词关键词对照 10/15（0.6667）；5 个无相关查询 1 个误报。对照采用研究脚本的二元词计分，不是生产FTS，不据此推断正式搜索提升幅度。
- 新进程加载 765.17 ms，总推理 5675.64 ms，512 维归一化向量；文件缓存可能预热，不等同机器重启后的冷缓存。
- 推理 Worker 的 fetch、Node http/https/net/tls/dns/dgram 入口拦截，联网尝试 0；渲染 context 离线。未做系统抓包。

## 资格字段含义

`publicSourceRecorded` 表示仓库固定来源材料已经记录；`networkAuditPassed` 表示上述推理入口与本地加载审计通过，范围不含系统抓包；`packagedRuntimePassed` 表示实际 EXE 的包内运行库和权重已实测；`qualityCalibrated` 表示固定校准阈值与开发者标注质量门槛达标。四个必需项通过后允许启用模型，不代表发布矩阵全部通过。

最终启用包须重新构建、重新核对身份并运行 UI 离线索引/检索。最终包、全套回归、系统网络、独立标注和干净 Windows 矩阵结果在后续段落分别记录。

## 最终含模型安装器与界面

C盘独立目录 `C:/Users/NO.6/AppData/Local/Temp/RainSoul-semantic-20261013` 构建成功，NSIS结束后完整资源审计通过。安装器149,273,841字节，已复制到 `release/semantic-20261013/RainSoul Setup 1.3.0.exe`；SHA-256 `f9b9b53e7c07b9e6b6f3207f65ce49faaab7eb142e0f55f3c061fc4cbf79510a`，签名 NotSigned，构建日志显示 signing 不代表已取得证书签名。

这份最终目录EXE重新运行底层验收通过：加载1555.01ms，总推理9678.07ms，改写13/15、研究关键词10/15、负例误报1、受观察网络入口0。新报告 `.tmp-model-qualification/packaged-final-20261013.json` 绑定最终EXE/ASAR/权重身份，不继承候选b的hash。

实际桌面验收 `.p0-semantic-ui4.log`：1项通过，19.8秒。UI创建原创知识，离线重建索引；改写查询在IPC和卡片中命中“环境烘托”知识；停用后hybrid明确回退关键词；实际EXE重启保留正文和停用偏好；最终包身份未变化。前3次尝试发现测试标签匹配、异步等待和已关闭程序清理问题，均修正后复跑，没有改生产检索结果迎合测试。

原始底层报告、UI报告和截图保存在C盘包的 `acceptance` 目录；截图已进入教材。仍未验证系统抓包、独立真人标注和干净Windows安装/升级/卸载，不宣称P0全部发布门禁通过。

## 源码收尾与独立审查

全套coverage首轮160文件、1497项通过，语句93.29%、分支88.65%、函数95.49%、行98.27%；typecheck、Lint和生产build通过，Demo74项通过。研究工具另有2项红绿回归；它使用统一生产资格并核对清单前后原始字节hash，替代错误的“资格必须false”断言。

桌面首轮30通过、2实际包专项跳过、1关闭超时。轨迹表明保存草稿按键结束1.25ms后测试即请求关窗，未等待异步保存和工作区卸载；修正测试等待知识库入口恢复，保留生产保存门禁。4项相关场景复验通过，完整桌面重跑结果后续记录，失败轮不计全绿。

独立review对比9865a40以来来源/资格、实际包、Windows资源编辑和凭据边界，未发现High；唯一Medium为上述研究回执，已修复并通过2项专项。研究关键词对照与生产FTS的区别已补文档。教材编译44章27图，截图进入源码晚于上述安装器，须重新打包，不沿用旧包hash。

最终单元回归161文件1499项通过，420.72秒，日志`.p0-semantic-final-unit.log`。第二次coverage曾1497通过、2项effect时序断言失败：标签选中先于焦点恢复、表单关闭先于dirty通知；仅改测试等待对应状态，33项专项通过后全套1499通过。首次coverage数值保持其执行范围，不将失败coverage轮次记成通过。

最终桌面全集`.p0-semantic-final3-desktop.log`为31通过、2实际包专项跳过，10.1分钟；含模型专项将显式指定新包另跑。此前全集第二轮static来源测试过早导航，被操作门禁拒绝，补等待章节标题可编辑后修正，失败日志保留。最终关键词搜索200样本P95=282.20ms。Demo74项、typecheck、Lint、生产build通过；终端NO_COLOR/FORCE_COLOR提示不影响运行，未作完整WCAG声明。

二次独立审查aada34e、d2e7c37、a41ec70确认原焦点、dirty、保存失败与关窗要求保留，未扩大超时、删场景或绕过生产门禁，无未修复High/Medium。开发经验已记入教材和本报告，Compound Engineering按耐久性规则不再重复创建相同条目；本机Claude Mem数据库缺失，本轮按技能降级为会话记录，未写入休眠gbrain。

## 新教材安装器复验

新教材的前两次重打包（临时目录`RainSoul-semantic-20261013-final`和`final2`）在复制`THIRD_PARTY_NOTICES.txt`时EBUSY失败。单独复制成功；实际builder的`getConfig`显示默认相对源与授权绝对源被拼接到同一个目标，`copyFiles`并行执行导致竞争。`70eb047`移除默认重复资源声明，统一由受审计配置提供，直接打包拒绝hook和许可/模型字节审计保留。真实配置回归先得到双份资源的红测，再24项专项全绿；typecheck、Lint、build通过，独立review无High/Medium。没有跳过声明、修改vendor或新增复制旁路。

第三次`C:/Users/NO.6/AppData/Local/Temp/RainSoul-semantic-20261013-final3`完整NSIS构建及最终资源审计通过。当前交付安装器为`release/semantic-final-20261013/RainSoul Setup 1.3.0.exe`，149,327,167字节，SHA-256为`ba3cf5c6a63fa9cc5111498fd4c6dddec637b44fb3ee6eb9a60a384ed648267f`，Authenticode为NotSigned。复制到release后再次校验相同。此前安装器及其hash只作为历史记录。

新包实际EXE底层报告`acceptance/retrieval-runtime-final.json`通过：加载866.9905ms、总推理7340.0289ms，512维归一化，改写Recall@5=13/15、研究二元词关键词对照10/15、5负例1误报；受观察网络入口0，EXE/ASAR/权重身份前后一致。夹具、阈值与审计范围沿用前述定义，非生产FTS对比、系统抓包或独立真人评估。

显式指定新包运行`bundled-semantic-model.spec.cjs`与`learning.spec.cjs`，2项27.7秒通过，日志`.p0-semantic-final-package-ui.log`。确认离线启用、知识改写查询与卡片、停用混合回退、重启稿件/偏好，以及44章27图教材、Markdown源文和历史作者练习保留。报告、日志、截图保存于新包`acceptance`。干净Windows安装/升级/卸载、全部P0真实云操作及正式受限网页渲染的未完成边界不变。

## 当前完整覆盖率结果

修正测试effect等待及重复资源配置后，重新执行完整`npm run test:coverage`，日志`.p0-semantic-final-green-coverage.log`退出0：161文件、1500项全部通过，420.68秒（含新增builder配置回归）。语句93.29%（7777/8336）、分支88.65%（5291/5968）、函数95.49%（1463/1532）、行98.27%（5003/5091）。本段是当前覆盖率结论；此前失败轮和1499项普通单测记录保留为历史，不冒充同一轮执行。

桌面全集31通过/2显式实际包专项跳过与Demo74项为本轮应用源码验证；后续改动仅为打包配置去重及其回归，新实际包另有底层验收、UI与教材2项通过。各轮独立报告，不合并宣称一次全套执行了所有场景。

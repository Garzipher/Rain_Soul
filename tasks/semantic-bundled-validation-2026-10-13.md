# 内置中文语义模型实测

日期：2026-10-13。采用用户批准的固定公开来源、许可与文件校验政策，不要求精确转换链证明。官方原站交叉与转换证明仍为 false，不能把镜像材料当官方证书。

## 已取得的底层证据

执行 `scripts/accept-packaged-retrieval-model.mjs`，指定 `release/semantic-candidate-20261013-b/win-unpacked/RainSoul.exe`。它实际启动 EXE，在主进程创建隔离推理 Worker，读取包内 ASAR 生产运行库、旁树 WASM 与固定权重。临时模型研究目录不参与加载，作品使用隔离目录。

候选 b 的整体构建在 EXE 资源编辑时失败，所以这份证据只证明该目录包的模型运行，不作为最终安装器构建成功。候选 a 同阶段失败；候选 c 在复制第三方声明时 EBUSY，模型不完整，排除出质量验收。失败原因与修复不得从记录中删去。

- 原始报告：`.tmp-model-qualification/packaged-candidate-b2-20261013.json`，包含 EXE、ASAR、WASM、运行库、权重及清单 SHA-256，启动前后身份一致。
- 固定夹具：100 条原创知识、30 个验收查询；夹具 hash 为 `787abac3aaaed9ddd30ca2e49b24da979d504ceecda88dd0e750c8a7789f2c61`。相关 ID 由开发者预标注，未经过独立真人复核。
- 固定阈值 `0.5125038418350374` 来自既有独立校准集，本轮没有用验收查询反调阈值。
- 中文改写 Recall@5：13/15（0.8667），关键词对照 10/15（0.6667）；5 个无相关查询 1 个误报。
- 新进程加载 765.17 ms，总推理 5675.64 ms，512 维归一化向量；文件缓存可能预热，不等同机器重启后的冷缓存。
- 推理 Worker 的 fetch、Node http/https/net/tls/dns/dgram 入口拦截，联网尝试 0；渲染 context 离线。未做系统抓包。

## 资格字段含义

`publicSourceRecorded` 表示仓库固定来源材料已经记录；`networkAuditPassed` 表示上述推理入口与本地加载审计通过，范围不含系统抓包；`packagedRuntimePassed` 表示实际 EXE 的包内运行库和权重已实测；`qualityCalibrated` 表示固定校准阈值与开发者标注质量门槛达标。四个必需项通过后允许启用模型，不代表发布矩阵全部通过。

最终启用包须重新构建、重新核对身份并运行 UI 离线索引/检索。最终包、全套回归、系统网络、独立标注和干净 Windows 矩阵结果在后续段落分别记录。

## 最终含模型安装器与界面

C盘独立目录 `C:/Users/NO.6/AppData/Local/Temp/RainSoul-semantic-20261013` 构建成功，NSIS结束后完整资源审计通过。安装器149,273,841字节，已复制到 `release/semantic-20261013/RainSoul Setup 1.3.0.exe`；SHA-256 `f9b9b53e7c07b9e6b6f3207f65ce49faaab7eb142e0f55f3c061fc4cbf79510a`，签名 NotSigned，构建日志显示 signing 不代表已取得证书签名。

这份最终目录EXE重新运行底层验收通过：加载1555.01ms，总推理9678.07ms，改写13/15、关键词10/15、负例误报1、受观察网络入口0。新报告 `.tmp-model-qualification/packaged-final-20261013.json` 绑定最终EXE/ASAR/权重身份，不继承候选b的hash。

实际桌面验收 `.p0-semantic-ui4.log`：1项通过，19.8秒。UI创建原创知识，离线重建索引；改写查询在IPC和卡片中命中“环境烘托”知识；停用后hybrid明确回退关键词；实际EXE重启保留正文和停用偏好；最终包身份未变化。前3次尝试发现测试标签匹配、异步等待和已关闭程序清理问题，均修正后复跑，没有改生产检索结果迎合测试。

原始底层报告、UI报告和截图保存在C盘包的 `acceptance` 目录；截图已进入教材。仍未验证系统抓包、独立真人标注和干净Windows安装/升级/卸载，不宣称P0全部发布门禁通过。

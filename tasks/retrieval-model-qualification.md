# 本机中文嵌入模型资格研究

日期：2026-10-10。任务6研究与生产运行库子任务；仅公开模型，不读取作者作品。研究目录不提交。

## 状态与固定选择

真实公开量化权重、字节hash、Windows Node与Electron主进程Worker的CPU WASM执行、生产适配器和固定质量夹具均已运行。生产资格仍有阻断项，不能据此开放语义入口或宣称任务6整体完成。

- 基础模型：BAAI/bge-small-zh-v1.5，上游参考修订 `7999e1d3359715c523056ef9478215996d62a620`。
- ONNX候选：Xenova/bge-small-zh-v1.5，固定修订 `75c43b069aac4d136ba6bc1122f995fedcfd2781`。
- 最终生产运行组合：`@huggingface/tokenizers@0.2.0` + `onnxruntime-web@1.31.0-dev.20260914-8d85527a0`，CPU WASM、单线程、不使用代理。
- ONNX实际`model_quantized.onnx`，CLS池化、L2归一化；未使用随机向量。Transformers.js4.3.1仅用于隔离对照研究，没有进入生产依赖链。
- BAAI参考修订不是已证明的Xenova转换源修订。转换仓库卡只声明base_model，精确转换源修订尚未核验。

## 获取与实际文件清单

HF官方API两次连接超时；固定修订文件通过hf-mirror.com读取。量化权重实际24,010,842字节，其SHA256与固定修订Git LFS指针及镜像API一致。尚缺官方原站交叉核验，不能把镜像元数据当独立官方证明。

运行必需五文件均已下载并校验；以下清单总计24,451,175字节，约23.32MiB。许可证/说明及运行库另计。

| 相对路径 | 实际字节 | 实际SHA256 |
| --- | ---: | --- |
| config.json | 716 | d4193ead3a810fd694fa8a31d7fc72fbaebc0668b603e398734bf2f6538ff42f |
| tokenizer.json | 439125 | 48cea5d44424912a6fd1ea647bf4fe50b55ab8b1e5879c3275f80e339e8fae26 |
| tokenizer_config.json | 367 | e6f3b96db926a37d4039995fbf5ad17de158dfb8f6343d607e4dbaad18d75f5a |
| special_tokens_map.json | 125 | b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3 |
| onnx/model_quantized.onnx | 24010842 | 15b717c382bcb518ba457b93ea6850ede7f4f1cd8937454aa06972366cd19bcc |

另下载README.md（1057字节，cb22054df1a98f7ee9d5b281d023e67c27cc316e1733baf03fc994d95c3048ab）、quantize_config.json（674字节，2cc488b20fa05fe86aba2fdc2be44d24827e11e2b7c7a0753d1427da6797b46f）。vocab.txt下载超时；完整tokenizer.json已足以运行本次真实试验，不将未取得文件列为已验证。

## 许可证与分发依据

- [BAAI固定模型卡](https://huggingface.co/BAAI/bge-small-zh-v1.5/blob/7999e1d3359715c523056ef9478215996d62a620/README.md)：frontmatter `license: mit`，文末说明模型可免费商业使用。实际卡27670字节，SHA256 c48a4eeea77f6b1d38b48ec1c5b8d4f86d5550cc43fa345a0db1b2ca1d082369。
- [Xenova固定模型卡](https://huggingface.co/Xenova/bge-small-zh-v1.5/blob/75c43b069aac4d136ba6bc1122f995fedcfd2781/README.md)：明确为上述BAAI模型ONNX转换，没有独立license字段/文件。必须带上游版权与MIT原文并记录转换溯源；不能声明已完整证明转换源精确修订。若发布门禁无法核验，则自行从固定BAAI权重导出和量化。
- [FlagEmbedding固定MIT原文](https://github.com/FlagOpen/FlagEmbedding/blob/fd1a2bdf69488ffebe0327999d4400d8c8058a0b/LICENSE)：实际保存1065字节，SHA256 587a673933425dbc36ec61268d3b954051b2d3ef3c9b322ede357976055ffdd5；生产模型清单已保留完整原文与固定链接。
- [Transformers.js 4.3.1 Apache-2.0原文](https://github.com/huggingface/transformers.js/blob/4.3.1/LICENSE)：已读取许可正文，临时npm包也含LICENSE。分发保留许可及上游NOTICE（如有）。
- ORT原生1.30.0固定许可已保存，用于早期研究，未分发原生DLL。最终ORT Web及common各固定提交MIT正文保存为版本fallback，SHA256均为`2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c`。
- ORT Web固定提交`8d85527a010e294a26b274749f74294b2a32cec5`完整ThirdPartyNotices也取得；UTF-8文件338088字节、SHA256 `143764b952fdb1a7c69ce653bfba74a7744d6a8a573bfb73e235fba356c83de3`。15个原文分片在构建时按固定清单拼接并校验长度/hash，保持上游所有声明，不能缺失或改写。tokenizers npm包自带Apache许可正文。
- 生产仅复制纯ORT WASM JavaScript/factory/权重引擎，并打包纯tokenizers；两npm包属于构建依赖。未分发Transformers/native/sharp/jinja/WebGL。声明收集器显式列出实际bundle模块，继续完整递归收集其他生产依赖。

## 真实执行与复现

资格脚本：`scripts/qualify-retrieval-model.mjs`。隔离依赖安装在`.tmp-model-qualification/runtime`，使用精确版本、`--ignore-scripts`、未改产品依赖。Windows CPU二进制已随npm包提供，install-metadata的win32/x64下载需求为空，无需安装CUDA或执行postinstall。

复现：`node scripts/qualify-retrieval-model.mjs`；Electron使用当前`node_modules/electron/dist/electron.exe`执行同一脚本。研究脚本仅读取`.tmp-model-qualification/model`，Electron userData也隔离在临时目录。

已保存原始报告`.tmp-model-qualification/qualification-node-worker.json`与`qualification-electron-main-worker.json`。机器：Intel i5-4460 3.20GHz，4核/4线程，约8GiB RAM，Windows10专业版10.0.19045。

| 受控新进程试验 | Node Worker | Electron主进程Worker |
| --- | ---: | ---: |
| 版本 | Node24.16.0 | Electron44.7.0 / 内置Node24.21.0 |
| hash校验、库导入及模型初载 | 909.51ms | 920.33ms |
| 三条文本首次批量推理 | 60.93ms | 97.22ms |
| 宿主基线RSS | 72736768字节 | 64376832字节 |
| 采样宿主峰值RSS | 193191936字节 | 184737792字节 |
| 宿主RSS增量峰值 | 120455168字节 | 120360960字节 |

这是单次、文件缓存可能已预热的新进程试验；不是重启机器后的冷缓存测试，也不是千条/二百查询P95或后台索引保存测试。RSS包括进程而非单个Worker，采样10ms，计入模型hash和运行库导入。30秒加载与1.5GiB增量上限断言通过，不替代生产预算验收。

真实中文输入为天气暗示人物孤独的查询、环境描写知识和数据库事务知识。查询实际38token；带指定中文查询前缀，文档不带前缀。输出[3,512]，CLS池化+L2归一化，所有值有限；范数误差<1e-5，重复嵌入最大差0。查询与文学段余弦0.649967，与数据库段0.345481。此一个排序样例只排除明显接线错误，不能代替30查询Recall@5/负例误报验收。

初次Electron脚本在主模块顶层await app.whenReady造成无窗口启动等待；研究脚本改为直接运行不依赖窗口API的Worker后通过。已终止三个本次试验遗留进程；没有停止用户应用。

## 零联网证据与剩余阻断

脚本设`env.allowRemoteModels=false`、`allowLocalModels=true`、关闭浏览器/文件cache，加载传`local_files_only:true`。在库导入前拦截JS fetch/http/https/net/tls/dns常用联网入口，实际两次最终试验均为0尝试。

该证据不是系统级抓包；原生DLL遥测关闭机制尚未核验，不声称已经满足“隐式请求与遥测关闭”的全部门禁。官方固定修订原站交叉核验、转换精确来源、完整依赖许可、系统级联网审计/原生遥测、实际打包EXE/干净安装、固定质量校准与并发保存性能仍阻断生产激活。

早期原生库Windows ETW默认开启；固定源码明确`ORT_DISABLE_TELEMETRY`仅适用于POSIX1DS，不能伪称该环境变量关闭Windows ETW。生产因此使用WASM，构建不引入原生ORT绑定或DLL。纯WASM入口和本地factory不包含Windows ETW接口；固定平台源码对非`USE_POSIX_TELEMETRY`使用基础Telemetry，完整系统级流量审计仍未执行，不据JS入口0次声明网络门禁通过。

## 最终生产适配器与稳定性

`src/workers/retrieval/model.ts`默认加载同目录`retrieval-runtime.cjs`；`runtime.ts`仅读取固定目录的tokenizer和ONNX字节。构建输出纯`retrieval-ort-wasm.cjs`以及`retrieval-wasm/`中factory/WASM；后两文件按asarUnpack配置从`app.asar.unpacked`加载，无CDN或隐式下载后备。

发现q8动态量化会令同一文本因批中其他文本改变而产生最大0.0144向量差。先写失败回归再改为每条独立session.run；外层批次仍最多32，重复与跨批组合结果差小于1e-5。此行为进入实现版本指纹，不能沿用早期批推理阈值。

最终固定生产适配器Node/Electron主进程Worker各真实运行：

| 指标 | Node Worker | Electron主进程Worker |
| --- | ---: | ---: |
| hash、加载 | 2022.90ms | 1874.27ms |
| 三文本首次推理 | 470.61ms | 299.83ms |
| 完整质量试验RSS增量 | 225402880字节 | 220160000字节 |
| 重复向量最大差 | 0 | 0 |
| JS网络入口尝试 | 0 | 0 |

仍是文件缓存可能已预热的新进程，不能代替生产打包/干净机器/千条索引及200查询P95验收。

## 固定质量与独立校准

100条原创中文写作知识、30个验收查询（15改写、10关键词、5无相关）和20个独立校准查询（10正例、10无相关）在推理前固定相关ID。夹具SHA256 `787abac3aaaed9ddd30ca2e49b24da979d504ceecda88dd0e750c8a7789f2c61`；知识均小于400token；评估调用实际`ranking.ts`的复合身份/最大chunk余弦/RRF60。

相关ID为开发者预标注，尚未完成独立真人审核。阈值只依据校准无相关集最大相似度加0.0001得到，不用验收集调参。最终逐条WASM阈值`0.5125038418350374`，校准正例Recall@5为0.9；Node和Electron一致。

| 验收项 | 最终实际结果 |
| --- | ---: |
| 15改写语义Recall@5 | 13/15=0.8667 |
| 15改写关键词Recall@5 | 10/15=0.6667 |
| 15改写混合Recall@5 | 13/15=0.8667 |
| 5无相关查询误报 | 1/5 |

失败q3（潜台词）、q6（转场）和q28（阑尾炎麻醉误匹配写作呼吸节奏）。数值达到约定目标，但真人相关性审核、官方固定原站核验、精确转换源、系统网络审计和打包运行门禁未全部通过。清单只记录阈值，五资格旗标维持false。

TDD覆盖adapter/runtime/安装存储/许可收集共26专项测试通过；运行库两模块覆盖Statements96.26%、Branches95.52%、Functions92.30%、Lines100%。专项ESLint、构建和diff检查通过。主任务进行完整测试/静态/实际包门禁与规范提交，临时权重/运行库/日志不提交。

## Worker边界、取消与ASAR独立验收

实际编译`retrieval-worker.cjs`复制到没有推理库的独立目录，以不存在的模型目录发送load/reload/search/index。资格旗标false时全部拒绝；在线程中记录fs异步入口、HTTP/socket/DNS/fetch和运行库require，模型读取/缓存创建/网络尝试/推理库加载均0。null、数组、数字和未知命令同样拒绝，之后线程仍能接收load，没有未处理异常退出。

可取消调度通过请求ID和AsyncLocalStorage隔离查询；查询优先排队文档。取消立即拒绝排队或当前查询等待者，当前不可中断CPU单条推理完成后丢弃回执；文档继续运行。先写失败TDD后实现，4专项测试通过，调度器Statements/Functions/Lines100%、Branches86.66%。

另用`@electron/asar`在研究目录创建实际ASAR：两个生产JS文件进入`app.asar/dist/desktop`，factory/WASM按相同布局解包。真实Electron44.7主进程加载ASAR内运行库并读取固定公开模型成功，输出[2,512]，跨批向量差0，fetch尝试0。此证据确认`app.asar`到`app.asar.unpacked`的本地factory/WASM路径与ES模块加载有效；报告保存于研究目录`asar-runtime-validation/report.json`，没有修改产品资格开关。

完整electron-builder受控pack尝试在并行项目测试重建期间失败：扫描时renderer旧hash文件`ai-workspace-DElEGS8n.js`已被其他构建删除，报ENOENT。该产物不能视为完成，完整EXE、干净机器、系统级网络审计仍须在最终稳定构建后串行验收；隔离ASAR成功不能替代这些门禁。

## 千条索引、二百查询与并行保存实测

运行`scripts/qualify-retrieval-performance.mjs`，真实生产WASM适配器、实际engine/cache/scheduler在独立检索Worker中工作；实际`database-worker.cjs`同时写入隔离新作品。1000条原创合成写作知识（84–99codepoint，中位92，每条单chunk）、200个固定查询（30个质量夹具查询循环，按次数采样）分别运行混合和关键词模式。fixtureHash `fe9b597bcae079fedfe2d11ef72bac13c7085eb45cf7ee593d1bc763411d8f63`，使用真实固定权重与哈希，不使用随机向量，不读作者库，不修改资格旗标。

| 指标 | 本次实际结果 | 门槛 |
| --- | ---: | ---: |
| 模型初始化 | 3780.56ms | ≤30000ms |
| 1000条首次索引 | 156534.49ms | 单列记录 |
| 200次混合P95 / 最大 | 284.06 / 583.52ms | P95≤1000ms |
| 200次关键词P95 / 最大 | 174.21 / 540.30ms | P95≤1000ms |
| 索引同时30次保存P95 / 最大 | 595.78 / 2079.49ms | 最大≤5000ms |
| 宿主与Worker合计RSS增量峰值 | 474578944字节 | ≤1.5GiB |
| CPU user / system / 总墙时间 | 173110 / 3172 / 214922ms | 单列记录 |

保存每次约18000字富文本文档，使用revision CAS与独立operationId。完成后重新创建实际数据库Worker读回revision31，确认含第30次保存内容；不把仅收到响应当持久化证明。网络JS入口实际0；全部数值门槛通过，完整JSON保存在研究目录`retrieval-performance-report.json`。

局限：单机i5-4460四核/约8GiB、Node24.16，文件缓存可能预热，CPU与RSS包含两个Worker；受主机其他测试进程竞争，未获取独立系统CPU占用/系统抓包。查询样本200次由30类固定文本循环构成，未证明200种独立文本分布；合成条目均单chunk且短于400token，不能替代长知识多chunk、完整生产EXE、干净机器与真实作者数据规模验收。质量正确性仍以独立的100知识/30查询评估与尚未完成的真人审核为准；本次性能通过不改变五资格旗标。

## 模型管理下载、空间、进度与取消

生产入口显式接入固定清单的HF下载：初始URL只能精确匹配清单仓库、修订及文件，重定向最多3跳且仅接受HF官方域名白名单。逐跳重新解析DNS，所有解析结果都必须为公网地址，并固定HTTPS连接lookup；GET不携带凭据、Cookie或作者正文，禁用连接池，校验证书。拒绝HTTP、私网、未知域名、压缩及超限广告长度/实际流，单文件120秒时限，不自动重试，远端错误统一脱敏。测试使用受控DNS/HTTPS响应夹具；本次没有取得官方源完整下载成功证据，因此来源资格旗标仍为false。

安装前确认目标卷可用空间不少于固定文件总量加8MiB余量，逐块报告operationId、来源、阶段、准确写入字节与总量。目录仅来自主进程选择，下载/取消IPC仅接收严格UUID操作编号；禁止并发安装，状态查询独立执行。停滞DNS/响应/文件流取消不等待远端下一块；选择目录期间取消阻止迟到选择开始导入。SHA与长度全部通过后才原子切换激活记录，取消/断流/短流/错误文件保持旧模型。未资格安装默认停用，启用和模型路径同样拒绝；旧记录即使声称enabled也显示disabled。

TDD定向33测试与后续2个状态/字节回归通过，新增网络和管理三模块逐文件覆盖均超过80%四维：commands97.09/93.96/95.45/100、download92.52/88.46/89.47/98，store92.55/87.15/92.59/100。owned文件ESLint无警告；全局类型检查曾通过，后续同行编辑AI审稿props的中间状态出现类型错误，由主代理完成最终全局验证。按gstack review清单复核SSRF、DNS重绑定、取消竞态、路径和原子激活，修复旧资格状态一致性问题。完整构建/桌面/全套验证由主代理串行执行，避免并行构建删除产物。五资格旗标、阈值与实际推理开关保持原状。

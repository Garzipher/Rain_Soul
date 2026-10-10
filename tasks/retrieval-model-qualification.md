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

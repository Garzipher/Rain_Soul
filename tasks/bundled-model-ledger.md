# 内置语义模型实施与门禁记录

日期：2026-10-13。功能分支：codex/restricted-render-bundled-model。用户已批准“先内置语义检索模型”，范围不含本机生成式模型。

## 基础设施与逐批验证

| 批次 | 提交 | 验证 |
| --- | --- | --- |
| selection.json与旧记录迁移 | 3f4f843 | 37项相关测试 |
| 可信resourcesPath、换源与迟到隔离 | 5f63f68 | 34项相关测试 |
| 来源准备、固定容量读取与包校验 | a66e9db | 29项相关测试 |
| 设置区分来源、文件、资格及偏好 | 48db4e3 | 14项UI测试 |
| 正式打包门禁与研究模式隔离 | 064a466 | 23项相关测试 |
| 实际包验收测试准备 | f7e646d | 未提供EXE时明确skip，不记成功 |
| 无模型实际目录EXE验收记录 | 32593b4 | 1项实际程序测试通过，15.8秒 |

测试数字有重叠，不相加作为完整总数。

来源脚本经历固定长度读取的RED→GREEN：stat后readFile会被并发增长绕过预算，改为最多声明长度+1字节。正式CLI/env不能传入可信锚；fixture注入仅用于纯函数验证。

独立审查发现首次安装无selection时可能将资格false写成偏好false；补回归并保持默认作者偏好，资格继续独立阻断推理。最终修复提交与验证在完整验证后更新。

## 真实产物证据

本轮显式无模型研究包：release/research-without-model/03cd3b17-c92c-4abb-b36a-327785535dc8/win-unpacked/RainSoul.exe。实际EXE/ASAR哈希、Electron44.7.0、截图和通过场景见[bundled-model-acceptance.md](bundled-model-acceptance.md)。报告持久保存在产物同级acceptance。

通过内容为：资源与ASAR无权重、真实IPC关键词与混合/语义回退、停用重启保持、写作保存读回。打包后新增源码修复不属于该旧哈希产物；最终完整构建后应生成新独立研究包，按新哈希重验。

## 来源与资格

候选Xenova/bge-small-zh-v1.5 revision75c43b069aac4d136ba6bc1122f995fedcfd2781，五文件24,451,175字节。BAAI参考revision7999e1d3359715c523056ef9478215996d62a620。现有候选卡只指出base_model，精确转换输入revision/hash/工具证明尚缺；文件hash匹配和MIT文本不补足转换来源。

仓库可信来源锚保持null；正式prepare与pack拒绝不完整来源，无模型研究模式只能新独立目录，不能覆盖正式release/current。不向外分发尚未满足来源门禁的候选权重。

| 门槛 | 状态 |
| --- | --- |
| 固定官方来源 | false，证据未完整 |
| 转换revision | false，精确转换链缺失 |
| 系统网络审计 | false，未执行 |
| 当前实际有模型包运行 | false，未验收 |
| 独立质量校准 | false，未完成 |
| 真实云模型 | 未联调，未读取作者Key或发送作品 |
| 干净Windows安装/升级/卸载 | 未执行 |

下一步先取得固定来源/转换证明，或以明确许可固定上游自行可复现转换；随后绑定新指纹做质量、系统网络、实际资源包和性能验证。五资格不因基础设施完成而改true。

## 教材与知识沉淀

第九卷追加“内置模型资源与资格验收”，包含ONNX/Tokenizer、resources与ASAR、hash与来源、偏好与资格、研究包实践及真实截图。学习课程采用新稳定key增量追加，不覆盖作者已改章节。

Claude Mem及Compound Engineering未提供可调用持久化接口，未写入替代库或gbrain。可复用发现保存于教材与此记录：来源声明必须绑定产物字节；运行偏好不能由资格推断；打包完成后必须检查实际resources；异步换源须先作废旧generation。

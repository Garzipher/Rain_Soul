# 凭据与本机模型分发审查

日期：2026-10-14

## 结论

- 当前 Git tracked 文件中未发现符合 OpenRouter、Hugging Face 等常见长 token 格式的凭据。
- 对全部可达 Git 历史对象（4,988 个对象）进行同一规则扫描，未发现上述格式命中。该结论不替代人工检查未知格式的密钥。
- 本机云端配置位于 `%LOCALAPPDATA%\RainSoul\ai-settings.json`，不在仓库目录。`AiSettingsStore` 使用 Electron `safeStorage`（Windows 上由 DPAPI 提供）加密，拒绝 `basic_text` 和明文降级；公开读取只返回服务配置与 `hasCredential`。
- 项目归档固定只包含 `manifest.json` 和 `project.sqlite`。AI 凭据、模型权重、模型缓存、头像和其他本机配置不进入 `.rainsoul` 归档。
- 桌面包审计拒绝 `ai-settings.json`、`.env`、`credentials`、作品目录及临时原子写入文件进入依赖包或 ASAR。

## Git 忽略规则

当前 `.gitignore` 已覆盖：

```text
**/ai-settings.json
**/.ai-settings-*.tmp
**/credentials.json
**/credentials.*.json
.env
.env.*
!.env.example
*.key
*.pem
```

保留 `.env.example` 作为不含秘密的配置说明。若未来确需提交公开测试证书或密钥格式 fixture，应增加明确的文件级例外，不要放宽整个后缀规则。

## BGE-small 分发

当前固定模型为 `Xenova/bge-small-zh-v1.5`，修订、五个运行文件的 SHA-256、模型卡和完整 MIT 许可原文记录在 `assets/retrieval-model-manifest.json` 与 `assets/retrieval-model-provenance.json`。

MIT 许可允许复制、修改和分发，但发布时应保留版权和许可声明。推荐：

1. 仓库保存清单、来源锚、许可正文和准备/审计脚本。
2. GitHub Release 附带实际模型资源压缩包或安装器，并附 `THIRD_PARTY_NOTICES.txt`、manifest 和 SHA-256。
3. 不把频繁变更的大权重直接提交到 Git 主历史，避免仓库膨胀和历史删除秘密/模型后的不可逆残留。
4. 下载模型时校验固定 revision、大小和 SHA-256；校验失败不启用模型，关键词检索继续可用。

## 复核建议

- 提交前继续运行 `git diff --check`、tracked 文件秘密扫描，并确认 `git status --ignored` 中本机配置仅出现在忽略路径。
- 发布前在干净目录执行桌面包审计，确认 ASAR、旁树 WASM、模型资源和第三方许可与 manifest 一致。
- 用户若曾把真实 API Key 粘贴到聊天、终端或截图中，应在服务商控制台撤销并重新创建；仓库忽略规则不能清除已暴露的旧凭据。

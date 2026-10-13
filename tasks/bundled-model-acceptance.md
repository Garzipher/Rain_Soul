# 内置模型实际包验收记录

日期：2026-10-13。最新无模型研究安装器生成、最终资源审计及指定实际EXE的32场景桌面全集通过（5.4分钟）。来源锚缺失、五资格保持false，正式权重捆绑及语义能力未放行。

## 当前产物与身份

目录：E:/soulrain/release/research-without-model/35492ba6-3fc7-4034-a7e3-c2230f157386/。源码构建基线 b19fa47，后续本轮记录仅改文档。RainSoul 1.3.0、Electron 44.7.0、Windows x64；真实IPC确认app.isPackaged=true，执行路径与资源路径匹配指定包。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| RainSoul Setup 1.3.0.exe | 133420321 | a668955d7592676a5308bf58f87bb5c865ee09ebfabec823d32a35cc55bf75d5 |
| win-unpacked/RainSoul.exe | 246302720 | 783b6d91ba08fa37f6319e60a2e99cabef6a4ae4a25b66d4cde297b1e700b7c0 |
| win-unpacked/resources/app.asar | 67861279 | 03d8a2d9aca6f8c42d870b58a285429b8aca721b63f5c7e9c8365b569e8d748f |

安装器和EXE的Authenticode状态均NotSigned。builder的signing日志不等于已签名；分发安装可能出现Windows发布者/信誉提示。构建成功不代表干净Windows安装、升级、卸载通过。

## 构建与最终审计

生产build后运行 node scripts/pack-desktop.mjs --without-bundled-model --installer，输出新UUID，不覆盖release/current、作者作品或已有产物。研究模式不复制候选权重。Vite仅清理dist/renderer，desktop写dist/desktop；正式准备和打包仍复核模型父树及可信来源，不能依赖build清理同级dist/retrieval-model。

审计在afterPack和整个builder完成后分别执行，实际EXE场景再独立重算当前dist与包成员。最终ASAR含6805文件、119解包文件；成员摘要11150f14396dde4ec0f4fec91afb1334a34f46c0447120333e3d4d70cd054e08，构建摘要267dc03ccc5a8bebb8027b2b9dbdd0a1eb7b2b40e936ee8a6f353e6b37d52ecc。资源仅含app.asar、其解包树、核验的官方default_app.asar和THIRD_PARTY_NOTICES；无模型、用户资料、数据库、云凭据、缓存或未知资源。

实际打包发现更新服务推断、EBUSY/open文件锁、NSIS在afterPack后追加elevate.exe，均按TDD修复：publish:null关闭推断；Windows UNKNOWN/EBUSY+open最多五次完整重试；关闭普通用户提权助手与请求；构建末尾再审计。未知资源仍拒绝。allowElevation:false不等于手动以管理员启动时绝无全用户安装选项。

## 可重现验证

```powershell
$env:RAINSOUL_TEST_EXECUTABLE = 'E:\soulrain\release\research-without-model\35492ba6-3fc7-4034-a7e3-c2230f157386\win-unpacked\RainSoul.exe'
npx playwright test --config playwright.desktop.config.cjs --output test-results-final-research-pack
$testExit = $LASTEXITCODE
Remove-Item Env:RAINSOUL_TEST_EXECUTABLE
exit $testExit
```

打包后勿在中间重建dist，避免构建与包摘要不一致。测试使用隔离资料及原创夹具，未读取作者作品或API Key。32场景全部通过，无跳过；其中受限渲染运行时仍启动独立开发Electron/测试bundle，不归为产品EXE渲染资格。补验实际EXE的720×540小窗口/键盘操作：网页和模型页面无横向溢出、页面错误为空。

| 验证 | 结果与边界 |
| --- | --- |
| resources/ASAR/解包成员 | 独立重算通过，无权重或未知资源 |
| 首次偏好与资格 | enabled=true、qualified=false、installed=false、source=bundled；偏好不等于推理资格 |
| 关键词/混合/语义IPC | keyword=ready，hybrid/semantic=fallback；关键词命中、modelFingerprint=null，无向量缓存 |
| 停用与重启 | enabled从true变false，重启保持，来源/资格不变 |
| 保存/重启、归档、删除恢复 | 实际EXE全集通过 |
| 关键词性能 | 百万统计字/千条知识、200正式样本、20预热另计；P95=174.60ms≤1秒，不是语义性能 |
| 固定来源/转换链 | 缺证据，正式捆绑阻断 |
| 系统观测零出站 | 未执行，渲染上下文offline不能代替 |
| 模型加载/内存/千条索引/语义200查询 | 无模型包不适用，真实模型待验 |
| 独立人工质量集 | 未完成 |
| 真实云/干净Windows10/11安装升级卸载 | 未执行 |

## 持久证据与失败记录

本包acceptance保存artifact-hashes、desktop-package-audit、bundled-model-research-report、设置截图、search-performance、restricted-render-runtime-report、入口截图、narrow-ui-report/两图、构建/桌面日志。原始全集位于test-results-final-research-pack；日志.p0-final3-real-desktop.log、.p0-final3-research-installer.log。

旧03cd3b17目录包只有当时专项证据，不适用新源码。7edaf528尝试被更新配置拒绝，e50c7a23因文件锁失败，bf0796ef虽生成安装器但晚增elevate.exe被构建后独立审计拒绝，均非交付产物。

开发入口首轮桌面30通过、1旧偏好断言失败、1实际包跳过；修正单项复验通过后，本包32全部通过。文件锁定向与静态并行有一次builder接口加载超时，串行34项及后续42项通过，失败轮不计成功。小窗口辅助脚本首次相对路径错误，修正后通过，未改产品。重复依赖和NO_COLOR/FORCE_COLOR提示已评估为引用/终端信息，生产构建无未处理警告。

## 旧资格命令边界

qualify-retrieval-model.mjs与qualify-retrieval-performance.mjs使用研究权重、源码Worker/适配器及开发者预标注夹具，不核验当前EXE。结果不自动放行当前来源、资源、系统隔离或独立质量。来源允许后须将来源材料、实际包/资源hash、系统网络和独立质量集身份绑定当前完整指纹重新验收。

最终源码门禁：158文件/1477测试，覆盖率93.28/88.63/95.47/98.26%；完整typecheck/Lint/build通过、Demo74通过。acceptance另保存final-coverage.log、coverage-summary.json、demo-suite.log及keyboard步骤/辅助脚本证据。源码测试未重建dist，当前包与构建摘要仍匹配。

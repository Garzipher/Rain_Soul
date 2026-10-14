# 灰字补全、AI续写与网页等待审查

日期：2026-10-14。按项目gstack review及checklist执行两遍只读检查；未修改生产代码或提交Git。灰字补全/AI续写由本代理独立审查；网页等待模块由本代理此前实现，其此次检查属于自查，不能冒称第二位独立审阅者。

## 初审发现（均已修复）

两项问题已按TDD补回归并修复：接受前后关闭历史组；空回执不再排队。最终二审见 `ghost-render-final-review-2026-10-14.md`，此处保留初审证据。

1. Medium，`src/renderer/lib/knowledge-ghost-extension.ts:72`：接受候选的普通insertText可能与400ms前刚输入的前缀合并为同一历史组。UndoRedo/ProseMirror默认newGroupDelay为500ms；作者输入“雨夜”后立即Tab，再撤销可能把“雨夜”一起撤掉。建议使用closeHistory开始独立接受事务，并隔离后续紧接着的作者输入；补最近输入→400ms→Tab→undo/redo回归，现有初始文档已有前缀的测试不能覆盖此路径。

2. Medium，`src/renderer/lib/knowledge-ghost-extension.ts:39`及`:88`：没有匹配候选时仍dispatch null；view.update遇新state且无候选又schedule，导致空知识库/短前缀/无匹配场景每400ms自动扫描和发事务，直到失焦。建议只在focus、正文/选区变化、外部refresh后排队；null回执不得自发重排。补长时间无匹配时事务/扫描次数不增长，以及下一次输入/资产refresh可重新查询的回归。

## 第一遍：数据、安全和并发

未发现确认High：灰字只使用DOM装饰与textContent；接受前不进入JSON或保存回调；接受时重核位置、段落、知识内容/revision、AI暂停和可编辑状态。来源使用readableKnowledgeSource，未把附带AI审核上下文放入出处属性。IME、取消、失焦、正文变化与知识变化路径已有回归。

AI续写提示明确使用已授权上下文、剧情因果、人物动机及写作特点。沿用主进程buildAiContext/buildAiReferences装配作品大纲/伏笔/StyleProfile及作者选择知识，沿用冻结发送预览、一次性确认、云凭据主进程读取、候选对比和CAS写入；本轮不把知识原句自动当AI续写。AI工具打开、发送/待确认/候选待审时暂停灰字，候选放弃或应用完成后可恢复。

正文等待共享40秒总期限和5秒额外期限；每次有界快照/解析前后检查资源健康；仅“无文章/空文章”重试，登录、容量与解析故障拒绝。取消和挂起由宿主看门狗控制；正式资格仍null、同源限制/隔离策略未放宽。

## 第二遍：范围、测试和交付边界

现有matcher9项、编辑器extension/组件回归与AI活动通知测试覆盖大部分批准交互。新增正文等待40项专项及8项真实Electron夹具通过，包括延迟和分阶段正文。上述两项确认缺口仍需TDD修复后再完整交付验证。

参考句前缀提示不判断剧情适合程度，不声称是语义生成；作者Tab接受与AI候选确认属于独立流程。源码等待机制不代表正式渲染已开放；临时Electron夹具的纯parser注入不证明最终包Worker部署。最终全套、完整静态检查、构建与安装包验证由主代理汇总，不从本报告推断全部发布门禁通过。

# 灰字知识句补全审查

日期：2026-10-14

## 结论

- `knowledge-ghost-extension.ts` 仅使用 ProseMirror `Decoration.widget` 绘制灰字，候选通过 `textContent` 注入，不能执行 HTML；不创建正文节点，不触发 `onUpdate`，因此未接受前不保存、不计字数、不进入作品 JSON。
- 候选生成使用当前段落末尾文本和本机知识条目，400ms 停顿后计算；不发起云请求，不调用 AI 续写。AI 工具打开、锁定、右键菜单、失焦、选区移动、正文变化和知识资产刷新都会清除候选。
- `Tab` 仅在光标位置、段落位置、服务端/本机知识条目内容及 `revision` 仍与候选一致时插入；插入是一次 ProseMirror 事务，可由撤销恢复。`Shift/Ctrl/Alt/Meta+Tab` 不接受候选。
- `Esc` 清除候选并抑制相同位置再次提示；移动光标或输入后会解除抑制。IME composition 期间不响应 Tab；compositionend 通过零延迟任务等待 ProseMirror 内部状态完成后重新计时。
- 出处在灰字 `title` 和 `aria-label` 中显示，候选不可聚焦、不可选中、`pointer-events:none`，不遮挡正文交互。
- 独立审查发现知识条目的 `source` 可能附带 AI 审核 JSON，其中含已授权上下文摘录；已修复为使用 `readableKnowledgeSource`，只展示作者可读出处，并新增回归测试确认审计上下文不会进入 DOM 属性。

## 验证证据

- `tests/unit/knowledge-completion.test.ts` 与 `tests/unit/knowledge-ghost-editor.test.tsx`：15 项通过，覆盖中文/英文前缀、可读来源、审计来源隔离、删除和 revision 失效、超长预算、XSS 文本、Tab/撤销、Esc、IME、失焦、选区、AI 暂停和锁定。
- `npx eslint src/renderer/lib/knowledge-ghost-extension.ts tests/unit/knowledge-ghost-editor.test.tsx`：通过。此前 `view(view)` 未使用参数已改为 `view()`。
- `npx tsc --noEmit`：通过。

## 待主代理整合

- `ChapterEditor` 已提供 `ghostPaused` 并用 refs 更新知识条目和锁定/暂停状态；`WritingWorkspace` 在 AI 工具打开时传递暂停状态。主代理应补一次组件层回归，证明资产变更和暂停不会让旧候选写入正文。
- CSS 使用 `.knowledge-ghost` 的低对比度灰色；正式视觉验收应确认暗色/高对比主题和系统字体下仍满足可读性。

# RainSoul 统一交互动效实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> 项目调度以 AGENTS.md 指定的 GSD Core 为准；保留代码审查流程。用户已确认规格，本计划待审阅。

**Goal:** 为现有界面的操作反馈、浮层、导航、折叠和条目变化建立一致的双向动效，保证业务操作不等待动画。

**Architecture:** CSS 令牌负责轻反馈，Motion 的 LazyMotion/presence 负责需要保留退出节点的组件，页面过渡使用原生 View Transitions 并提供回退。保留原生 dialog 和 Radix Select，所有状态继续由现有业务层拥有。

**Tech Stack:** React 19.3、TypeScript 6、Electron 44、CSS、Radix Select、Motion React。

**Spec:** [已确认规格](../specs/2026-10-15-unified-interaction-motion-design.md)

## Global Constraints

- 保留白色界面、天蓝色强调色与 Demo 标志；不增加另一套主题或动画库。
- 保存、停止生成、取消网络请求与窗口关闭不等待动画；不为动效增加全局业务锁。
- 菜单进入 160ms/退出 140ms；模态进入 220ms/退出 160ms；页面 180ms；折叠与列表 180–220ms。
- 进入曲线 `cubic-bezier(.16,1,.3,1)`；退出曲线 `cubic-bezier(.4,0,1,1)`。
- 运行时监听减少动态效果，覆盖 CSS、Motion、页面快照、伪元素；禁用位移、缩放、弹性和循环运动。
- 正文输入不触发布局测量；页面只挂载一份业务组件；中文输入法组合期间回退即时导航。
- 按用户要求，本轮不执行自动化、功能、视觉或性能测试。可以编写回归用例但不运行，不宣称已通过；类型检查、Lint、构建、文档检查分别如实记录。
- 中文注释、文档和提交信息；在 main 小步提交。每项超过 500 行必须再拆提交，不删除有效测试文件。

## Review Focus

1. 快速关闭后重开：旧退出回调不能关闭新弹窗，也不能清空 AI 候选。
2. 动效中停止生成、取消请求、关闭窗口：业务处理立即开始，不等待动效结束。
3. 折叠区域仍有键盘焦点：焦点回到触发器，隐藏区域不能继续接收键盘操作。
4. 系统动态效果偏好运行时变化或后台节流：浮层仍能关闭，不依赖单一 animationend。
5. 快速切页或 View Transition API 异常：最终页面对应最后有效导航，没有重复编辑器或重复请求。

## 文件与依赖

新增 `src/renderer/motion/`：令牌、统一 Provider、原生 dialog 生命周期、折叠容器、导航协调器。业务组件只声明状态，不各自实现卸载计时器。

执行顺序：任务 1 → 任务 2 → 任务 3 → 任务 4；任务 5 汇总交付。与全局知识库计划共享 `App.tsx`、知识工作区和拆书页，修改这些文件时串行合并。

### 任务 1：统一令牌、减少动态效果和基础控件反馈

**Files:** 修改 `package.json`、`package-lock.json`、`src/renderer/main.tsx`、`src/renderer/styles.css`；新建 `src/renderer/motion/tokens.ts`、`motion-provider.tsx`、`motion.css`。

**Interfaces:** 导出 `MotionProvider({ children }: { children: ReactNode })`、`useMotionPreference(): { reduced: boolean }` 和 `motionTokens`。Provider 统一配置 LazyMotion 与 MotionConfig；令牌输出秒值用于 Motion、毫秒值用于 CSS，来源只定义一处。

- [ ] 编写 `tests/unit/motion-provider.test.tsx`，断言系统偏好从 normal 变 reduced 时订阅更新、卸载取消监听、按钮 disabled 不出现成功反馈；本轮不执行。
- [ ] 添加单一 `motion` 依赖并锁定解析版本；使用 `motion/react` 的 LazyMotion、domAnimation 和轻量组件，避免在业务文件导入完整功能包。
- [ ] 建立时长、缓动、透明度和距离令牌，将按钮、图标、标签的 pointer/keyboard 激活反馈统一为按下 80–100ms、释放 140–160ms。
- [ ] 全局 CSS 覆盖 reduced-motion 的 animation、transition、伪元素；不能通过无差别缩短持续时间导致业务结束回调失效。
- [ ] 运行 `npm run typecheck`、`npm run lint`、`npm run build`，只记录实际结果；提交 `feat(motion): 建立统一动效与减少动态效果规范`。

### 任务 2：弹窗、Select 和菜单的完整出入生命周期

**Files:** 新建 `src/renderer/motion/animated-dialog.tsx`；修改 `src/renderer/components/workspace-tool-dialog.tsx`、`workspace-tool-dialog.css`、`context-menu.tsx`、`select-field.css`，以及 `create-dialog.tsx`、`structure-dialog.tsx`、`conversation-dialog.tsx`、`manuscript-dialog.tsx`、`knowledge-copy-dialog.tsx` 和其调用点。

**Interfaces:** `AnimatedDialog({ open, label, onRequestClose, restoreFocusTo, children }: { open: boolean; label: string; onRequestClose: () => void; restoreFocusTo?: () => HTMLElement | null; children: ReactNode })`。`open` 由业务层控制；可复用工具内容保持挂载，瞬态表单由调用点的 AnimatePresence 保留至退出完成。

- [ ] 编写 `tests/unit/animated-dialog.test.tsx` 与 `tests/unit/context-menu-motion.test.tsx`：覆盖退出后重开、嵌套 Select 的 Esc、触发器删除后的焦点回退、reduced-motion 中完成关闭；本轮不执行。
- [ ] 保留原生 dialog top layer；关闭事件立即通知业务层，视觉退出完成后再 close。为每轮打开分配代次，取消旧退出；卸载和关闭窗口时同步清理，不等待完成事件。
- [ ] 将现有弹窗适配到共享容器；保持原有提交失败表单、正文选区、AI 候选和保护规则，不因关闭动画丢失它们。
- [ ] 菜单选择立即执行，退出壳 inert 且不再拥有焦点；只向仍有效的触发器归还焦点。Select 使用 Radix data-state 关键帧，继续使用最近 dialog 的 Portal。
- [ ] 编写停止/关闭顺序的回归用例，断言 `onRequestClose` 在动画完成回调之前调用；不执行。静态审阅所有 busy 禁用条件，避免把视觉退出当作业务锁。
- [ ] 静态检查与构建后按弹窗、菜单两次提交：`feat(motion): 统一原生弹窗出入生命周期`、`feat(motion): 补齐菜单与下拉双向过渡`。

### 任务 3：导航、侧栏和树节点连续变化

**Files:** 新建 `src/renderer/motion/page-transition.ts`、`animated-collapse.tsx`；修改 `src/renderer/App.tsx`、`components/sidebar.tsx`、`chapter-tree.tsx`、`conversation-workspace.tsx`、`knowledge-dictionary.tsx`、`plot-workspace.tsx` 和相关 CSS。

**Interfaces:** `transitionPage(commit: () => void, options: { reduced: boolean; composing: boolean }): void`，最后一次有效调用优先；`AnimatedCollapse({ open, triggerRef, children }: { open: boolean; triggerRef: RefObject<HTMLElement | null>; children: ReactNode })`。

- [ ] 编写 `tests/unit/page-transition.test.ts`、`tests/unit/animated-collapse.test.tsx`：覆盖连续导航、API 抛错、组合输入、内部焦点移出、折叠后 inert；本轮不执行。
- [ ] 仅在原有保存保护允许导航后调用 transitionPage；支持时由 startViewTransition 包裹同步 React 提交，快速导航跳过旧快照。失败回退只能提交一次，不能重试保存或挂载第二份编辑器。
- [ ] 主侧栏、章节栏、会话列表、知识分类和剧情树使用共用折叠规则；隐藏前焦点回到触发器，箭头同步旋转；窄屏抽屉保留遮罩和焦点约束。
- [ ] 导航选中指示器连续移动，分页切换不移动正文光标，不对正文编辑器设置 layout 动画。
- [ ] 静态检查与构建后按页面导航、树与侧栏分别提交，避免混入全局库功能。

### 任务 4：卡片、列表和操作结果反馈

**Files:** 修改 `src/renderer/App.tsx`、`components/knowledge-workspace.tsx`、`book-extraction-workspace.tsx`、`book-extraction-ai-panel.tsx`、`conversation-workspace.tsx`、`settings-page.tsx` 和对应样式。

**Interfaces:** 复用任务 1–3 的 Provider、令牌和折叠容器。列表使用业务稳定 ID 作为 key；仅可重排的条目启用位置动画。

- [ ] 更新 `tests/unit/knowledge-workspace.test.tsx`、`conversation-workspace.test.tsx` 的语义断言，并新增 `tests/unit/operation-feedback.test.tsx`：删除失败仍保留条目、disabled 不暗示成功、停止回调立即调用；本轮不执行。
- [ ] 作品集创建/删除/排序、知识两行卡片原位展开、标签和分页切换、拆书选段/审核均显示对应反馈。只有业务提交成功后退出条目并让邻项补位。
- [ ] 会话消息出现和生成状态克制淡入；取消和停止保持立即可用，不对流式每个字播放重排动画。设置分组使用统一反馈，不引入整表单缩放。
- [ ] 提示与错误保留可读文字，ARIA live 播报不因动画重复；列表长内容不逐帧扫描或测量整页。
- [ ] 静态检查与构建后按作品/知识、拆书/会话分别提交。

### 任务 5：覆盖审阅与交付

**Files:** 修改 `README.md` 中实际受影响的用法、`docs/` 下现有发布记录和本计划任务状态；学习内容写入 `learning/项目全流程开发学习/` 对应章节。

- [ ] 逐项对照规格第 7 节检查源代码覆盖，记录遗漏，不将“有 transition 样式”等同于完整出入生命周期。
- [ ] 使用项目 review 技能审阅最终 diff，重点追踪保存、取消、窗口关闭、焦点和旧退出回调；不运行功能或视觉测试。
- [ ] 运行 `npm run typecheck`、`npm run lint`、`npm run build` 和 `git diff --check`。若有失败先修复；记录测试未执行，不写体验验收通过。
- [ ] 更新教材：先讲浏览器绘制与组件卸载，再讲本项目方案、代码路径、失败处理和练习；不得编造截图。
- [ ] 提交 `docs(motion): 更新动效使用与实现说明`。若生成新安装产物，只报告真实存在的路径及构建状态，不标记发布门禁通过。

## 计划自审

已覆盖规格中的按钮、菜单、模态、页面、侧栏、树、卡片、分页、创建/删除/排序及状态反馈；五项 Review Focus 均归入任务 1–4 的待执行回归用例。系统窗口动画不在应用控制范围。知识数据归属、来源素材和检索接口由独立全局知识库计划负责。

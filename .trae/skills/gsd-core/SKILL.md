---
name: gsd-core
description: GSD Core 全局任务调度器 - 基于 GSD (Get Stuff Done) 框架的高级任务分解与子 Agent 编排系统
triggers: ["gsd-core", "dispatch task", "任务调度", "子agent调度"]
---

# GSD Core 全局任务调度器

## 概述

GSD Core 是本项目的**全局默认任务调度器**，基于 GSD (Get Stuff Done) 框架的任务分解与编排理念构建。它在 superpowers 原生调度能力之上，提供更智能的任务分解、依赖分析、并行分组和质量门禁机制。

**核心调度算法：任务分解 → 依赖分析 → 并行分组 → 子 Agent 调度 → 结果聚合 → 质量门禁**

**设计哲学：**
- 借鉴 GSD 框架的 phase/wave/task 三级分解模型
- 保留 superpowers 的 TDD 流程和代码审查模块作为质量基石
- 优先级高于 subagent-driven-development 和 dispatching-parallel-agents
- 自动识别何时需要调度、何时应回退到原生能力

## 优先级声明

GSD Core 是**全局默认调度器**，在任务调度场景下优先级顺序为：

1. **gsd-core** ← 默认首选
2. subagent-driven-development
3. dispatching-parallel-agents
4. executing-plans

**生效条件：** 当任务数 >= 2 或预估复杂度为 medium 以上时，自动触发 GSD Core 调度。

**回退条件：** 当 GSD Core 判定任务过于简单（单任务 + low 复杂度）或需要特殊原生能力时，自动回退到 superpowers 原生调度器。具体规则见 [dispatch-rules.md](dispatch-rules.md)。

## 保留模块说明

以下 superpowers 模块**保持不变**，GSD Core 不替代它们，而是在调度流程中主动调用：

### TDD 流程 (test-driven-development)

- **地位：** 核心质量基石，完整保留
- **集成方式：** GSD Core 在生成子 Agent 任务时，对代码实现类任务自动注入 TDD 要求
- **调用时机：** 每个实现型子任务的执行阶段，由子 Agent 遵循 TDD 流程
- **不变性：** TDD 的红-绿-重构循环、测试先行原则完全沿用 superpowers 原定义

### 代码审查 (requesting-code-review / receiving-code-review)

- **地位：** 最终质量门禁，完整保留
- **集成方式：**
  - `requesting-code-review`：GSD Core 在所有子任务完成后，调用该 skill 发起最终代码审查
  - `receiving-code-review`：子 Agent 接收审查反馈时的行为规范不变
- **调用时机：** 结果聚合阶段完成后、交付用户之前
- **不变性：** 审查清单、严重级别定义、修复循环机制完全沿用

## 核心调度算法

### 阶段一：任务分解 (Task Decomposition)

将用户需求或高层任务拆解为可独立执行的原子任务。

**分解原则：**
- **单一职责：** 每个任务只做一件事，边界清晰
- **可验证性：** 每个任务有明确的完成标准和验证方法
- **适当粒度：** 单个任务建议 30 分钟 ~ 2 小时工作量
- **最小依赖：** 尽量减少任务间的耦合

**分解输出：**
```
任务列表 = [
  { id, name, description, type, files, depends_on, complexity, verification }
]
```

**任务类型：**
- `implementation` — 代码实现（自动应用 TDD）
- `research` — 技术调研/方案分析
- `refactor` — 重构优化
- `test` — 测试补充/修复
- `docs` — 文档编写
- `review` — 代码审查（由 requesting-code-review 处理）
- `config` — 配置变更

### 阶段二：依赖分析 (Dependency Analysis)

构建任务依赖图，识别执行顺序约束。

**分析维度：**
- **文件依赖：** 任务 A 修改的文件是任务 B 的输入
- **接口依赖：** 任务 A 定义的接口被任务 B 使用
- **数据依赖：** 任务 A 产出的数据被任务 B 消费
- **顺序依赖：** 业务逻辑上的先后关系

**输出：** 有向无环图 (DAG)，每个节点是任务，边表示依赖关系。

**环检测：** 如发现循环依赖，立即分解或合并任务以打破环。

### 阶段三：并行分组 (Parallel Grouping)

将无依赖的任务组织为并行执行波次 (waves)。

**分组算法：**
1. 从 DAG 的入度为 0 的节点开始
2. 所有入度为 0 的任务组成当前波次
3. 执行完当前波次后，移除已完成节点，重新计算入度
4. 重复直到所有任务分组完毕

**波次优化：**
- 同波次任务数建议 2~5 个，过多会增加协调成本
- 小型同类型任务可合并为批量任务减少调度开销
- 高复杂度任务独占波次以保证资源

### 阶段四：子 Agent 调度 (Subagent Dispatch)

为每个任务创建并调度专用子 Agent。

**Agent 生成规则（详见 dispatch-rules.md）：**
- 根据任务类型选择 Agent 角色和能力模型
- 根据复杂度选择模型层级（cheap / standard / most-capable）
- 构造精确的任务指令，包含上下文、约束、验证标准
- 每个 Agent 拥有独立上下文，不继承调度器会话历史

**调度策略：**
- 同一波次内的任务并行调度
- 不同波次间顺序执行，前一波次全部完成才启动下一波次
- 动态监控子 Agent 状态，处理超时、阻塞、失败等异常

**模型选择原则：**
- 机械实现任务（1-2 文件，完整 spec）：快速廉价模型
- 集成判断任务（多文件协调，模式匹配）：标准模型
- 架构设计任务（需要全局理解）：最强模型
- 审查任务：与 diff 规模和复杂度匹配的模型

### 阶段五：结果聚合 (Result Aggregation)

收集所有子 Agent 的产出，整合为统一结果。

**聚合内容：**
- 代码变更：汇总所有提交，检查冲突
- 测试结果：合并测试报告，确认全量通过
- 文档产出：整理文档变更
- 风险记录：收集每个 Agent 报告的 concerns 和风险

**冲突检测：**
- 文件级冲突：多个 Agent 修改同一文件
- 接口级冲突：Agent 间的接口定义不一致
- 逻辑级冲突：实现逻辑相互矛盾

如发现冲突，触发修复循环：指派专门 Agent 解决冲突，然后重新验证。

### 阶段六：质量门禁 (Quality Gate)

在交付用户前执行最终质量检查。

**门禁检查项：**
1. **测试门禁：** 全部测试通过（单元 + 集成）
2. **代码审查门禁：** 调用 requesting-code-review 进行最终审查
3. **构建门禁：** 生产构建成功，无警告
4. **规范门禁：** Lint / 类型检查通过
5. **功能门禁：** 验收标准全部满足

**门禁结果：**
- ✅ **通过：** 所有检查项通过，交付用户
- ⚠️ **有条件通过：** 存在 Minor 级别问题，记录后交付
- ❌ **不通过：** 存在 Critical/Important 问题，进入修复循环

**修复循环：**
- 最多 2 轮修复（最终审查后一轮 + 修复后再审查一轮）
- 超过 2 轮仍有问题，升级为需要人工介入

## 自动调度触发条件

满足以下**任一条件**即自动触发 GSD Core 调度：

| 条件 | 阈值 | 说明 |
|------|------|------|
| 任务数量 | >= 2 | 2 个及以上独立任务 |
| 预估复杂度 | medium 及以上 | medium / high / critical |
| 涉及文件数 | >= 3 | 修改/创建 3 个及以上文件 |
| 涉及模块数 | >= 2 | 跨 2 个及以上模块/子系统 |

**复杂度评估标准：**
- **low：** 单文件修改，逻辑简单，风险低
- **medium：** 多文件修改，需要理解模块关系
- **high：** 跨模块变更，涉及架构调整，需要设计判断
- **critical：** 核心系统变更，高风险，影响面广

## 与 superpowers 保留模块的集成方式

### 与 test-driven-development 的集成

GSD Core 不重新实现 TDD，而是在任务层面应用 TDD 约束：

1. **任务标记：** `implementation` 类型任务自动标记为 TDD 任务
2. **指令注入：** 子 Agent 的 dispatch prompt 中包含 TDD 要求
   - "你必须遵循 TDD 流程：先写失败测试，再实现功能，最后重构"
   - "参考 superpowers:test-driven-development skill 的规范"
3. **验证强化：** 任务验证标准中必须包含测试覆盖要求
4. **审查检查：** 代码审查时检查 TDD 执行质量

### 与 requesting-code-review 的集成

GSD Core 将代码审查作为最终质量门禁的核心环节：

1. **触发时机：** 所有子任务完成、结果聚合通过后
2. **调用方式：** 直接调用 `superpowers:requesting-code-review` skill
3. **审查范围：** 本次调度涉及的全部代码变更
4. **审查模型：** 使用最可用的模型（most-capable）
5. **结果处理：**
   - 审查通过 → 质量门禁通过
   - 审查发现问题 → 进入修复循环
   - 修复后进行 scoped re-review
6. **残留问题裁决：** 超过修复轮次仍存在的问题，由调度器裁决并记录

### 与 receiving-code-review 的集成

子 Agent 在实现任务过程中如需处理审查反馈，遵循 receiving-code-review 规范：

1. 子 Agent 的 prompt 中包含 receiving-code-review 的行为准则
2. 审查反馈通过文件形式传递给子 Agent
3. 子 Agent 按规范修复并记录

### 与其他 superpowers 技能的关系

| Skill | 关系 | 说明 |
|-------|------|------|
| brainstorming | 前置 | 任务分解前如需需求澄清，调用 brainstorming |
| writing-plans | 替代 + 增强 | GSD Core 的分解算法是 writing-plans 的超集 |
| executing-plans | 替代 + 增强 | GSD Core 的调度执行是 executing-plans 的超集 |
| subagent-driven-development | 优先级更高 | GSD Core 优先；复杂单任务可回退到 SDD |
| dispatching-parallel-agents | 优先级更高 | GSD Core 优先；简单并行任务可回退 |
| systematic-debugging | 保留 + 调用 | Bug 类任务由子 Agent 调用该 skill |
| verification-before-completion | 集成 | 质量门禁阶段应用其验证清单 |
| finishing-a-development-branch | 保留 | 分支收尾阶段调用 |

## 调度配置

调度器行为由 `.trae/skill-config/dispatch-config.json` 配置文件控制。

**主要配置项：**
- `defaultDispatcher`：默认调度器名称
- `priorityOrder`：调度器优先级顺序
- `preservedSkills`：保留不变的技能列表
- `autoDispatchThreshold`：自动调度触发阈值

详见 [dispatch-config.json](../skill-config/dispatch-config.json)。

## 调度规则

详细的触发/回退/生成规则见 [dispatch-rules.md](dispatch-rules.md)。

## 典型工作流示例

```
用户：给用户模块添加登录、注册、密码重置三个功能

GSD Core 调度流程：

[阶段一：任务分解]
分解为 3 个实现任务 + 1 个集成任务：
- Task 1: 登录功能实现 (implementation, 复杂度 medium)
- Task 2: 注册功能实现 (implementation, 复杂度 medium)
- Task 3: 密码重置功能 (implementation, 复杂度 medium)
- Task 4: 集成测试与统一验证 (test, 复杂度 medium)

[阶段二：依赖分析]
Task 1、2、3 互相独立（共享用户模型但无依赖关系）
Task 4 依赖 Task 1、2、3 的完成
DAG: Task1→Task4, Task2→Task4, Task3→Task4

[阶段三：并行分组]
Wave 1: Task 1, Task 2, Task 3（并行执行）
Wave 2: Task 4（顺序执行）

[阶段四：子 Agent 调度]
Wave 1: 并行调度 3 个 implementer subagent
  - Agent A: 实现登录功能 + TDD
  - Agent B: 实现注册功能 + TDD
  - Agent C: 实现密码重置 + TDD
等待全部完成...

Wave 2: 调度 1 个 tester subagent
  - Agent D: 集成测试 + 端到端验证

[阶段五：结果聚合]
- 汇总 3 个功能模块的代码变更
- 检查接口一致性（用户模型统一）
- 合并测试结果（单元测试全部通过）
- 集成测试通过

[阶段六：质量门禁]
- 测试门禁：✅ 全部通过
- 调用 requesting-code-review 进行最终审查
- 代码审查：发现 2 个 Minor 问题，记录后通过
- 构建门禁：✅ 构建成功
- 交付用户
```

## 异常处理

### 子 Agent 失败

- **单任务失败：** 不影响其他并行任务，单独重试或升级模型
- **多任务级联失败：** 暂停后续波次，分析根因后调整策略
- **最大重试次数：** 每个任务最多 3 次实现尝试 + 2 次审查修复

### 上下文耗尽

- 使用 ledger 文件追踪进度（参考 subagent-driven-development）
- 上下文压缩后从 ledger 恢复状态
- 关键决策全部记录在 ledger，不依赖会话记忆

### 需求变更

- 变更影响当前波次：暂停未开始的任务，重新分解和分组
- 变更影响已完成任务：评估回退成本，决定是重做还是在后续波次修复
- 所有变更记录在 ledger 的 Ruling 部分

# Skill 集成配置实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 GSD Core、Claude Mem、Compound Engineering 三款 Skill 集成到当前项目的 Skill 系统中，分别替换调度层、记忆层，并挂载知识复利后置处理层。

**Architecture:** 在 `.trae/skills/` 下创建三个适配层 Skill，分别封装三款外部项目的核心能力。通过配置文件建立调度路由、记忆转发和后置处理钩子，实现与现有 superpowers/gstack 体系的无缝集成。保留 TDD 和代码审查模块不变。

**Tech Stack:** Markdown (SKILL.md 格式)、JSON 配置、PowerShell 脚本、SQLite (记忆层)

**Spec:** 用户需求文档 — 调度层替换、记忆层替换、知识复利层挂载

## Global Constraints

- 保留 superpowers 的 TDD 流程 (`test-driven-development`) 和代码审查模块 (`requesting-code-review`, `receiving-code-review`) 不变
- 仅替换调度层（subagent-dispatch），不影响其他 superpowers 技能
- 记忆层数据迁移不丢失原有 gbrain 历史数据
- 所有 Skill 文件放在 `.trae/skills/` 目录下，遵循现有 SKILL.md 格式规范
- 配置文件使用 JSON 格式，便于读取和版本管理
- 所有代码注释、文档、commit message 使用中文

## Review Focus

1. **调度层兼容性** — GSD Core 替换后，原有的 superpowers 子 agent 调用是否会被正确路由，TDD 和代码审查流程是否完全不受影响
2. **记忆数据完整性** — gbrain 历史数据迁移到 Claude Mem 后是否完整，读写转发是否正确，gbrain 是否真正进入休眠
3. **后置处理触发时机** — Compound Engineering 是否在所有开发任务完成后正确触发，知识沉淀是否结构化，是否会干扰主流程
4. **配置优先级** — 调度层优先级设置是否正确，GSD Core 是否确实优先于 superpowers 原生调度
5. **可回退性** — 三项配置是否都可以独立禁用/回退，不影响系统基础运行

---

### Task 1: GSD Core 调度层 Skill 封装与配置

**Files:**
- Create: `.trae/skills/gsd-core/SKILL.md`
- Create: `.trae/skills/gsd-core/config.json`
- Create: `.trae/skills/gsd-core/dispatch-rules.md`
- Create: `.trae/skill-config/dispatch-config.json`

**Interfaces:**
- Consumes: GSD 项目的 task dispatch 模式（从 `get-shit-done/workflows/execute-phase.md` 提取）
- Produces: `gsd-core` 技能，作为全局默认任务调度器，优先级高于 superpowers 的 `subagent-driven-development` 和 `dispatching-parallel-agents`

- [ ] **Step 1: 提取 GSD 核心调度逻辑**

从 `get-shit-done/workflows/execute-phase.md` 和 `get-shit-done/references/agent-contracts.md` 中提取核心调度模式：
- 任务依赖分析与分组
- 子 Agent spawn 契约
- 结果收集与整合
- 质量门禁检查

- [ ] **Step 2: 创建 gsd-core Skill 主文件**

创建 `.trae/skills/gsd-core/SKILL.md`，包含：
- GSD Core 的核心调度算法（任务分解→依赖分析→并行分组→子 Agent 调度→结果聚合→质量门禁）
- 与 superpowers TDD 和代码审查模块的集成点
- 明确的触发条件和优先级声明
- 保留 TDD 和代码审查流程不变的声明

- [ ] **Step 3: 创建调度配置文件**

创建 `.trae/skill-config/dispatch-config.json`，内容：
```json
{
  "defaultDispatcher": "gsd-core",
  "priorityOrder": [
    "gsd-core",
    "subagent-driven-development",
    "dispatching-parallel-agents",
    "executing-plans"
  ],
  "preservedSkills": [
    "test-driven-development",
    "requesting-code-review",
    "receiving-code-review"
  ],
  "autoDispatchThreshold": {
    "taskCount": 2,
    "estimatedComplexity": "medium"
  }
}
```

- [ ] **Step 4: 创建调度规则文档**

创建 `.trae/skills/gsd-core/dispatch-rules.md`，详细说明：
- 何时触发 GSD Core 调度（长任务自动转交）
- 何时回退到 superpowers 原生调度
- 保留模块的调用方式
- 子 Agent 生成规则

- [ ] **Step 5: 验证 gsd-core 技能文件结构**

检查 SKILL.md 是否符合现有技能格式规范，确认：
- YAML frontmatter 正确（name, description, triggers）
- 触发词配置正确
- 技能说明清晰

- [ ] **Step 6: 提交**

```bash
git add .trae/skills/gsd-core/ .trae/skill-config/dispatch-config.json
git commit -m "feat(gsd-core): 添加 GSD Core 调度层技能和配置

- 封装 GSD 任务调度核心算法
- 设置为全局默认任务调度器，优先级高于 superpowers 原生调度
- 保留 TDD 和代码审查模块不变
- 添加调度配置文件和规则文档"
```

---

### Task 2: Claude Mem 记忆层 Skill 封装与数据迁移

**Files:**
- Create: `.trae/skills/claude-mem/SKILL.md`
- Create: `.trae/skills/claude-mem/memory-config.json`
- Create: `.trae/skills/claude-mem/migration-script.ps1`
- Create: `.trae/skill-config/memory-config.json`
- Create: `.trae/memory/gbrain-export.json` (迁移后生成)

**Interfaces:**
- Consumes: gbrain 历史记忆数据、Claude Mem 的 mem-search 技能模式
- Produces: `claude-mem` 技能作为全局唯一记忆存储层，gbrain 进入休眠状态

- [ ] **Step 1: 创建 claude-mem Skill 主文件**

创建 `.trae/skills/claude-mem/SKILL.md`，包含：
- 记忆读写接口规范（read, write, search, update）
- 三层渐进式披露架构说明
- 与 gstack 的集成方式（转发所有记忆请求）
- gbrain 休眠模式说明

- [ ] **Step 2: 创建记忆层配置文件**

创建 `.trae/skill-config/memory-config.json`，内容：
```json
{
  "activeMemoryLayer": "claude-mem",
  "legacyLayer": "gbrain",
  "legacyLayerStatus": "dormant",
  "forwardAllRequests": true,
  "migrationCompleted": false,
  "storage": {
    "type": "sqlite",
    "path": ".trae/memory/claude-mem.db"
  }
}
```

- [ ] **Step 3: 扫描并导出 gbrain 历史数据**

检查 gstack 相关目录中是否有 gbrain 数据：
- 检查 `~/.gstack/` 目录
- 检查项目内 `.gstack/` 目录
- 导出所有记忆条目到 `.trae/memory/gbrain-export.json`
- 统计条目总数

- [ ] **Step 4: 创建迁移脚本**

创建 `.trae/skills/claude-mem/migration-script.ps1`，功能：
- 读取 gbrain-export.json
- 转换为 Claude Mem 格式
- 写入 SQLite 数据库
- 输出迁移统计（成功/失败/跳过数量）

- [ ] **Step 5: 执行数据迁移**

运行迁移脚本，验证：
- 所有 gbrain 条目成功迁移
- 数据完整性验证（抽样检查）
- 输出迁移结果统计

- [ ] **Step 6: 更新配置标记迁移完成**

将 `memory-config.json` 中的 `migrationCompleted` 设为 `true`

- [ ] **Step 7: 验证记忆层配置**

确认：
- claude-mem 技能可被正确调用
- 记忆读写请求正确转发到 claude-mem
- gbrain 不再写入新数据

- [ ] **Step 8: 提交**

```bash
git add .trae/skills/claude-mem/ .trae/skill-config/memory-config.json .trae/memory/
git commit -m "feat(claude-mem): 集成长记忆层并迁移 gbrain 历史数据

- 创建 claude-mem 技能作为全局记忆存储层
- 配置所有记忆请求转发到 Claude Mem
- 导出并迁移 gbrain 历史记忆数据
- gbrain 进入休眠状态，不再写入新数据"
```

---

### Task 3: Compound Engineering 知识复利层 Skill 挂载

**Files:**
- Create: `.trae/skills/compound-engineering/SKILL.md`
- Create: `.trae/skills/compound-engineering/knowledge-config.json`
- Create: `.trae/skill-config/postprocess-config.json`
- Create: `.trae/knowledge/knowledge-base.json`
- Create: `.trae/knowledge/categories.json`

**Interfaces:**
- Consumes: superpowers 开发计划、gstack 交付产物
- Produces: 结构化知识库，后续项目启动时自动检索推荐

- [ ] **Step 1: 创建 compound-engineering Skill 主文件**

创建 `.trae/skills/compound-engineering/SKILL.md`，包含：
- 后置处理触发条件（所有开发任务完成后自动触发）
- 知识收集范围（开发计划、交付产物、架构决策、修复记录）
- 结构化沉淀格式（分类、标签、摘要、完整内容）
- 知识检索与推荐机制

- [ ] **Step 2: 创建后置处理配置**

创建 `.trae/skill-config/postprocess-config.json`，内容：
```json
{
  "postProcessSkills": [
    {
      "name": "compound-engineering",
      "trigger": "after-all-dev-tasks",
      "priority": 1,
      "enabled": true
    }
  ],
  "knowledgeBase": {
    "path": ".trae/knowledge/",
    "autoCollect": {
      "superpowersPlans": true,
      "gstackDeliverables": true,
      "architectureDecisions": true,
      "codeReviewFindings": true
    },
    "categories": [
      "architecture-patterns",
      "best-practices",
      "bug-patterns",
      "design-patterns",
      "integration-solutions",
      "performance-optimizations"
    ]
  }
}
```

- [ ] **Step 3: 创建知识库结构**

创建知识库目录结构和初始文件：
- `.trae/knowledge/knowledge-base.json` — 主知识库索引
- `.trae/knowledge/categories.json` — 分类定义
- 按分类创建子目录

- [ ] **Step 4: 导入 Compound Engineering 现有知识**

从 `compound-engineering-plugin/docs/solutions/` 中提取关键知识文档：
- 技能设计模式（39篇）
- 最佳实践（4篇）
- 工作流模式（5篇）
- 架构模式（1篇）
- 集成方案（3篇）

导入到知识库并统计条目数。

- [ ] **Step 5: 配置知识检索钩子**

在 skill 中添加知识检索逻辑：
- 新项目启动时自动触发知识检索
- 基于项目关键词匹配历史知识
- 推荐可复用的方案和模式
- 避免重复造轮子

- [ ] **Step 6: 验证知识复利层配置**

确认：
- compound-engineering 技能可被正确调用
- 后置处理钩子配置正确
- 知识库初始条目统计正确
- 知识检索功能可用

- [ ] **Step 7: 提交**

```bash
git add .trae/skills/compound-engineering/ .trae/skill-config/postprocess-config.json .trae/knowledge/
git commit -m "feat(compound-engineering): 挂载知识复利后置处理层

- 创建 compound-engineering 技能作为全局后置处理器
- 配置自动收集开发计划和交付产物
- 导入 Compound Engineering 现有知识库
- 配置新项目启动时的知识检索与推荐机制"
```

---

### Task 4: 集成验证与结果输出

**Files:**
- Create: `.trae/skill-config/integration-status.json`
- Modify: `.trae/skills/gstack/SKILL.md` (添加记忆转发说明)
- Create: `docs/skill-integration-report.md`

**Interfaces:**
- Consumes: 三项配置的所有文件
- Produces: 集成状态报告、当前生效规则清单

- [ ] **Step 1: 创建集成状态文件**

创建 `.trae/skill-config/integration-status.json`，汇总所有配置状态：
```json
{
  "dispatchLayer": {
    "active": "gsd-core",
    "priority": ["gsd-core", "subagent-driven-development", "dispatching-parallel-agents"],
    "preserved": ["test-driven-development", "requesting-code-review", "receiving-code-review"],
    "status": "active"
  },
  "memoryLayer": {
    "active": "claude-mem",
    "legacy": "gbrain",
    "legacyStatus": "dormant",
    "migrationCompleted": true,
    "totalMemoryEntries": 0,
    "status": "active"
  },
  "knowledgeLayer": {
    "active": "compound-engineering",
    "trigger": "after-all-dev-tasks",
    "totalKnowledgeEntries": 0,
    "status": "active"
  }
}
```

- [ ] **Step 2: 更新 gstack 技能说明**

在 gstack 的 SKILL.md 中添加记忆层转发说明，告知所有记忆操作通过 claude-mem 进行。

- [ ] **Step 3: 生成集成结果报告**

创建 `docs/skill-integration-report.md`，包含：
1. 调度层替换成功确认 + 当前生效调度规则
2. 记忆层替换成功确认 + 历史记忆同步结果 + 记忆库条目总数
3. 知识复利层挂载成功确认 + 知识库历史条目数
4. 保留模块清单（TDD、代码审查）
5. 配置文件位置索引

- [ ] **Step 4: 最终验证**

检查所有文件是否存在：
- `.trae/skills/gsd-core/SKILL.md`
- `.trae/skills/claude-mem/SKILL.md`
- `.trae/skills/compound-engineering/SKILL.md`
- `.trae/skill-config/dispatch-config.json`
- `.trae/skill-config/memory-config.json`
- `.trae/skill-config/postprocess-config.json`
- `.trae/skill-config/integration-status.json`

- [ ] **Step 5: 提交**

```bash
git add .trae/skill-config/integration-status.json docs/skill-integration-report.md
git add .trae/skills/gstack/SKILL.md
git commit -m "docs: 生成 Skill 集成配置结果报告

- 汇总调度层、记忆层、知识层配置状态
- 列出当前生效的所有规则
- 提供配置文件索引"
```

---

## Self-Review

**1. Spec coverage:**
- ✅ GSD Core 设为全局默认调度 Skill，优先级高于 superpowers 原生调度 — Task 1
- ✅ 长任务自动转交给 GSD Core — Task 1 (autoDispatchThreshold)
- ✅ 保留 TDD 和代码审查模块 — Task 1 (preservedSkills)
- ✅ Claude Mem 设为全局唯一记忆层 — Task 2
- ✅ 同步 gbrain 历史数据 — Task 2 (migration)
- ✅ gbrain 进入休眠 — Task 2 (legacyLayerStatus: dormant)
- ✅ Compound Engineering 设为后置处理 — Task 3
- ✅ 自动收集计划和产物 — Task 3 (autoCollect)
- ✅ 知识检索推荐 — Task 3 (知识检索钩子)
- ✅ 输出确认和统计 — Task 4

**2. Step scan:** 每个步骤都有明确的动作和可验证的结果，没有模糊的 TBD。

**3. Type consistency:** 所有配置文件使用一致的 JSON 格式，技能文件使用一致的 SKILL.md 格式。

**4. Review Focus:** 
- 调度层兼容性 → Task 1 Step 4 详细定义了调度规则和回退机制
- 记忆数据完整性 → Task 2 Step 3-5 包含导出、迁移、验证全流程
- 后置处理触发时机 → Task 3 Step 2 明确定义了 trigger 条件
- 配置优先级 → Task 1 Step 3 priorityOrder 明确定义
- 可回退性 → 每个配置都有 enabled/status 字段，可独立禁用

**5. Proportion:** 计划长度合理，与任务复杂度匹配。

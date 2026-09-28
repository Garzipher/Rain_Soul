---
name: claude-mem
version: 1.0.0
description: Claude Mem 全局持久记忆层 - 跨会话记忆存储与智能检索系统
triggers:
  - claude-mem
  - 记忆搜索
  - memory search
  - 记忆存储
---

## 概述

Claude Mem 是项目全局唯一的持久记忆存储层，负责接管所有跨会话记忆的读写、检索和管理操作。它替代了原有的 gbrain 记忆系统，提供更稳定的本地 SQLite 存储和更智能的三层渐进式披露检索架构。

## 记忆读写接口规范

### read - 读取记忆

按 ID 或键名读取单条记忆记录。

**使用场景：** 需要获取已知标识的特定记忆内容时。

**参数：**
- `id` (string): 记忆条目的唯一标识符
- `key` (string, 可选): 记忆的业务键名，与 id 二选一

**返回：** 记忆条目对象，包含 id、key、content、metadata、created_at、updated_at 等字段。

### write - 写入记忆

新增一条记忆记录。

**使用场景：** 当产生需要跨会话保留的信息时，如用户偏好、项目决策、技术选型结论、常见问题解答等。

**参数：**
- `key` (string): 记忆的业务键名，用于检索和去重
- `content` (string): 记忆内容，建议使用结构化文本
- `category` (string, 可选): 分类标签，如 "preference"、"decision"、"fact"、"pattern"
- `tags` (string[], 可选): 标签数组，用于多维检索
- `ttl` (number, 可选): 过期时间（秒），不传则永久有效
- `importance` (number, 可选): 重要程度 1-5，默认为 3

**返回：** 新创建的记忆条目对象。

### search - 搜索记忆

按关键词、分类、标签等条件检索记忆。

**使用场景：** 不确定记忆的具体位置，需要通过语义或关键词查找相关记忆时。

**参数：**
- `query` (string): 搜索关键词
- `category` (string, 可选): 按分类过滤
- `tags` (string[], 可选): 按标签过滤
- `limit` (number, 可选): 返回条数上限，默认 20
- `minImportance` (number, 可选): 最低重要程度过滤

**返回：** 匹配的记忆条目数组，按相关度排序。

### update - 更新记忆

更新已有的记忆记录。

**使用场景：** 当已有记忆的内容发生变化需要修正时。

**参数：**
- `id` (string): 记忆条目的唯一标识符
- `content` (string, 可选): 更新后的内容
- `category` (string, 可选): 更新后的分类
- `tags` (string[], 可选): 更新后的标签
- `importance` (number, 可选): 更新后的重要程度

**返回：** 更新后的记忆条目对象。

### delete - 删除记忆

删除指定的记忆记录。

**使用场景：** 记忆过期、信息过时或用户明确要求删除时。

**参数：**
- `id` (string): 记忆条目的唯一标识符

**返回：** 删除成功确认。

## 三层渐进式披露架构

Claude Mem 采用三层渐进式披露（Progressive Disclosure）架构，确保在不同场景下提供恰到好处的记忆信息量，避免信息过载。

### 第一层：摘要层（Summary Layer）

- **内容：** 高度压缩的记忆摘要，仅包含最核心的事实和偏好
- **触发时机：** 会话开始时自动加载，提供上下文基线
- **数据量：** 控制在 500 字以内
- **作用：** 让 AI 快速了解项目概况和用户核心偏好，避免重复询问基础信息

### 第二层：相关层（Relevant Layer）

- **内容：** 与当前任务主题相关的记忆集合
- **触发时机：** 当检测到特定主题或用户明确搜索时加载
- **数据量：** 控制在 2000 字以内
- **作用：** 在特定任务上下文中提供足够的背景信息，支持深度推理

### 第三层：完整层（Full Layer）

- **内容：** 完整的记忆记录，包括历史细节和完整上下文
- **触发时机：** 用户明确请求查看完整记忆，或需要深度回溯时
- **数据量：** 无限制，按需分页
- **作用：** 支持完整的历史追溯和详细信息查询

### 披露策略

1. 默认只加载第一层摘要
2. 根据对话主题自动判断是否需要激活第二层
3. 第三层必须由用户显式触发
4. 每一层的切换都应有明确的状态反馈

## 与 gstack 的集成方式

Claude Mem 作为 gstack 技能套件的底层记忆基础设施，所有 gstack 技能的记忆请求统一转发到 claude-mem。

### 转发规则

- gstack 技能中所有涉及记忆读写的操作，统一调用 claude-mem 技能
- 不再直接访问 gbrain 或其他记忆存储
- 转发路径：gstack 技能 → claude-mem 技能 → SQLite 存储

### 集成点

1. **会话启动：** gstack 启动时自动从 claude-mem 加载摘要层记忆
2. **技能执行：** 各技能在需要记忆操作时，通过 Skill 工具调用 claude-mem
3. **会话结束：** 将本次会话的重要收获写入 claude-mem
4. **搜索路由：** 记忆类搜索请求直接路由到 claude-mem 的 search 接口

## gbrain 休眠模式说明

### 休眠状态定义

gbrain 已进入**休眠（Dormant）**状态：

- **写入已停止：** 不再向 gbrain 写入任何新数据
- **只读访问：** 保留对 gbrain 历史数据的只读访问权限，用于历史查询
- **请求转发：** 所有新的记忆读写请求自动转发到 claude-mem

### 数据迁移状态

- 迁移状态：已完成
- 迁移时间：见 `.trae/skill-config/memory-config.json`
- 历史数据导出文件：`.trae/memory/gbrain-export.json`

### 回退机制

如遇 claude-mem 不可用的极端情况：
1. 自动降级为会话内内存记忆
2. 记录降级日志
3. 待 claude-mem 恢复后同步回写

## 数据存储方式

### 存储引擎

- **类型：** SQLite 本地数据库
- **路径：** `.trae/memory/claude-mem.db`
- **优势：** 零依赖、嵌入式、事务支持、便于备份迁移

### 数据结构

核心表 `memories`：

| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PRIMARY KEY | 唯一标识符（UUID） |
| key | TEXT UNIQUE | 业务键名 |
| content | TEXT NOT NULL | 记忆内容 |
| category | TEXT | 分类 |
| tags | TEXT | 标签（JSON 数组） |
| importance | INTEGER DEFAULT 3 | 重要程度 1-5 |
| created_at | INTEGER | 创建时间戳 |
| updated_at | INTEGER | 更新时间戳 |
| expires_at | INTEGER | 过期时间戳（NULL 表示永不过期） |
| metadata | TEXT | 元数据（JSON 对象） |

### 索引

- `idx_memories_key` - 业务键名唯一索引
- `idx_memories_category` - 分类索引
- `idx_memories_importance` - 重要程度索引
- `idx_memories_expires_at` - 过期时间索引

## 何时调用此技能

当出现以下情况时，应调用 claude-mem 技能：

1. **用户明确提到：** "记住"、"记忆"、"回忆"、"搜索记忆"、"memory" 等关键词
2. **产生持久化信息：** 用户表达偏好、做出重要决策、约定后续事项
3. **需要历史上下文：** 新会话开始需要了解项目背景和历史决策
4. **跨技能共享：** 一个技能的产出需要被另一个技能使用

## 调用示例

**写入一条用户偏好记忆：**
- 操作：write
- key: "user.preference.language"
- content: "用户偏好使用中文沟通和中文代码注释"
- category: "preference"
- tags: ["用户偏好", "语言", "中文"]
- importance: 5

**搜索项目相关记忆：**
- 操作：search
- query: "技术选型"
- category: "decision"
- limit: 10

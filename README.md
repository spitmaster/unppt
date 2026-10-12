# SDD 开发脚手架

> Specification-Driven Development | 规范驱动开发

---

## 🎯 选择你的开发模式

| 场景 | 你的情况 | 使用命令 |
|------|---------|----------|
| **A** | 有完整的 PRD 或需求文档 | `> 请基于 docs/prd.md 生成 SPEC.md` |
| **B** | 只有模糊想法，边做边看 | `> 帮我做个 XXX（先做个简单的）` |
| **C** | 已有项目代码，继续开发 | `> 请诊断当前项目` |
| **D** | 有老项目文档需要迁移 | `> 请执行 olddocs 吸收流程` |

---

## ⚡ 首次使用（重要）

### 如果你是 AI 工具

项目打开后，请先执行：

```
> 请查看 docs/AI配置指南.md，按指南初始化 AI 环境
```

这会自动：
1. 检测是否存在 `olddocs/` 并执行吸收流程
2. 同步适合你的配置文件（rules、agents 等）

### 如果你是用户

告诉 AI：

```
> 请初始化 AI 环境
```

或直接：

```
> 请查看 docs/01-使用说明.md
```

### ⚠️ 不同 AI 工具的生效差异（务必阅读）

- **CodeBuddy**：安装插件后，`.codebuddy/rules/` 中的 SDD 规范**自动加载、立即生效**，无需额外操作。
- **Claude Code**：插件不会自动向项目注入指令。**必须先运行 `/sdd-starter:init`** 把 `CLAUDE.md` 写入项目，SDD 指导才会生效。

> 结论：**Claude Code 用户请务必先执行 `/sdd-starter:init`**；CodeBuddy 用户装完即可用（仍建议 init 以生成项目专属的 `CODEBUDDY.md`）。

---

## 🆕 新功能：olddocs 自动吸收

如果你的项目有历史文档，可以迁移到 `olddocs/` 目录：

```
olddocs/
├── 需求文档/      → 融入功能说明
├── 技术设计/      → 融入架构文档
├── API文档/       → 创建 API 章节
├── 项目笔记.md    → 融入上下文
└── 术语表.md      → 融入最佳实践
```

AI 启动时会**自动**扫描并整合这些文档。

详见：[olddocs/README.md](./olddocs/README.md)

---

## 📚 文档索引

### 核心文档

> 📂 完整文档都在 [`docs/`](./docs/) 目录，**直接浏览目录即可了解有哪些规范与指南**——文档会随时增减，这里不再逐一罗列，以免与实际文件失配。新手从 [docs/01-使用说明.md](./docs/01-使用说明.md) 起步。

### AI 配置

| 文档 | 说明 |
|------|------|
| [docs/AI配置指南.md](./docs/AI配置指南.md) | ⭐ AI 初始化指南 |
| [docs/ai-config/](./docs/ai-config/) | 各工具配置文件 |

### 迁移支持

| 文档 | 说明 |
|------|------|
| [olddocs/README.md](./olddocs/README.md) | ⭐ 历史文档迁移说明 |
| [olddocs/需求文档/](./olddocs/需求文档/) | 需求文档示例 |
| [olddocs/技术设计/](./olddocs/技术设计/) | 技术设计示例 |

### 模板和扩展

| 目录 | 说明 |
|------|------|
| [docs/templates/](./docs/templates/) | 模板文件 |
| [docs/prompts/](./docs/prompts/) | AI 提示词 |
| [docs/scripts/](./docs/scripts/) | 自动化脚本 |
| [docs/skills/](./docs/skills/) | 可复用 skill |
| [docs/agents/](./docs/agents/) | Agent 定义 |
| [docs/example/](./docs/example/) | 示例代码 |

---

## 🚀 快速开始

### 方式 1: 使用插件（推荐）

如果您使用 **Claude Code** 或 **CodeBuddy**，可以直接安装 `sdd-starter` 插件（命令自动适配当前工具）：

```bash
# 1. 安装插件（首次）
/plugin install sdd-starter

# 2. 初始化脚手架
/sdd-starter:init

# 3. 更新脚手架（后续）
/sdd-starter:update

# 4. 升级插件（拉取最新代码）
/sdd-starter:upgrade

# 5. 检查状态
/sdd-starter:check

# 6. 多仓 workspace：把各成员仓代码现状总结进主仓文档
/sdd-starter:digest
```

### 方式 2: 手动复制

如果不使用插件，可以手动复制：

```bash
# 1. 复制 docs/ 目录（两工具共用）
cp -r sdd-starter/docs ./

# 2a. Claude Code：复制入口模板
cp sdd-starter/docs/ai-config/for-claude.md ./CLAUDE.md.template

# 2b. CodeBuddy：复制规范目录 + 入口/Agents 模板
cp -r sdd-starter/.codebuddy ./
cp sdd-starter/docs/ai-config/CODEBUDDY.md.template ./
cp sdd-starter/docs/ai-config/for-codebuddy.md ./AGENTS.md.template
```

> 其余工具（Cursor / Copilot / Antigravity / Qoder）的入口模板见 `docs/ai-config/for-*.md`。

### 初始化 AI 环境

```bash
# 使用 CodeBuddy
> 请初始化 AI 环境

# 或手动查看文档
> 请查看 docs/01-使用说明.md
```

### 开始开发

根据你的情况选择场景 A/B/C/D（见上方「选择你的开发模式」）。

---

## ⚡ AI 工具使用

### 自动配置同步 + olddocs 吸收

```
任何 AI 工具首次打开项目时：
1. 读取本 README.md
2. 按 docs/AI配置指南.md 初始化
3. ⭐ 自动检测并吸收 olddocs/ 内容
4. 自动同步对应的配置文件到项目根目录
```

### 支持的工具

| 工具 | 配置文件 | 自动加载机制 |
|------|----------|-------------|
| Claude Code | `CLAUDE.md` | 项目根目录自动加载 |
| Cursor | `.cursorrules` | 项目根目录自动加载 |
| CodeBuddy | `CODEBUDDY.md` + `.codebuddy/rules/*.md` | 双重自动加载 |
| GitHub Copilot | `.github/copilot-instructions.md` | 自动加载 |
| Antigravity | 配置文件 | 自动加载 |
| Qoder | 配置文件 | 自动加载 |

#### CodeBuddy 自动加载机制（推荐）

CodeBuddy 支持**双重自动加载**：

1. **项目指令** - `CODEBUDDY.md`（项目根目录）
   - 提供项目上下文和说明
   - 优先级：项目根目录 > `.codebuddy/` > `~/.codebuddy/`

2. **强制规则** - `.codebuddy/rules/*.md`
   - 自动加载为 enforced rules（强制规则）
   - 出现在系统提示的 `<always_applied_workspace_rules>` 部分
   - 优先级最高，AI 必须遵守

**使用方式**：

```bash
# 方式 1: 使用模板（推荐）
cp docs/ai-config/CODEBUDDY.md.template CODEBUDDY.md
# 然后编辑 CODEBUDDY.md，填入项目具体信息

# 方式 2: 使用 Agent 定义（可选）
cp docs/ai-config/for-codebuddy.md AGENTS.md
# 然后在 CodeBuddy 中使用 @SDD-Architect 等触发词
```

**脚手架已包含**：
- `.codebuddy/rules/sdd-workflow.md` - SDD 工作流程强制规则（自动加载）
- `docs/ai-config/CODEBUDDY.md.template` - 项目指令模板（手动复制到项目根目录）
- `docs/ai-config/for-codebuddy.md` - Agent 定义（手动复制到 `AGENTS.md`）

### 手动加载

```
> 请严格遵循 docs/03-工作流程.md 中的 SDD 开发流程
```

---

## 📁 目录结构

```
sdd-starter/
├── README.md      # 本文档（唯一入口）
├── olddocs/       # 历史文档目录（迁移用，可选）
└── docs/          # 所有规范、指南、配置、模板、脚本、skill、agent
```

> 详细内容**直接浏览 [`docs/`](./docs/) 目录**即可——文档会随时增减，这里不再逐一罗列，以免与实际文件失配。

---

## ❓ 常见问题

**Q: 根目录会很乱吗？**
> 不会！根目录只有 `README.md` + `docs/` + `olddocs/`。AI 配置文件由 AI 自动同步，不会手动创建。

**Q: olddocs 是什么？**
> 如果你从老项目迁移，可以把历史文档放到 `olddocs/`。AI 会自动扫描并吸收其中的信息，充实 `docs/` 体系。

**Q: 如何添加新的 skill/agent？**
> 将好的 skill/agent 规则添加到 `docs/skills/` 或 `docs/agents/` 目录。

**Q: 第一次用 AI 开发需要做什么？**
> 告诉 AI：`> 请初始化 AI 环境`

---

## 📄 License

MIT

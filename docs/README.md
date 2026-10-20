> **unppt 本项目的文档**：使用说明和技术设计在 [docs/zh/](zh/)（中文）和 [docs/en/](en/)（English），入口见根目录 [README.md](../README.md) 的文档地图；需求真相源 [SPEC.md](../SPEC.md)、开发者用的扩展点说明 [architecture.md](architecture.md)、进展 [todo/dev.md](todo/dev.md)。
> `docs/` 下其余文件（01~09、agents、templates、prompts、小程序/3D 指南等）是 sdd-starter 脚手架自带的通用模板，和本项目无关。

# AI 工具配置中心

> 本目录包含各种 AI 编程工具的配置文件，AI 会自动检测并同步到项目中。

---

## 工作原理

```
┌─────────────────────────────────────────────────────────┐
│  任何 AI 工具打开项目（首次）                              │
│                    │                                     │
│                    ▼                                     │
│         AI 读取根目录 README.md                          │
│                    │                                     │
│                    ▼                                     │
│      README.md 告诉 AI："请查看 docs/AI配置指南.md"       │
│                    │                                     │
│                    ▼                                     │
│      AI 执行 AI配置指南.md 中的初始化流程                  │
│                    │                                     │
│                    ▼                                     │
│      自动复制对应工具的配置文件到项目根目录                 │
│                    │                                     │
│                    ▼                                     │
│      配置生效，AI 按 SDD 流程工作                          │
└─────────────────────────────────────────────────────────┘
```

---

## 目录结构

```
docs/
├── AI配置指南.md              # ⭐ AI 首次打开时自动执行
├── ai-config/                 # 各工具配置文件
│   ├── for-claude.md          # Claude Code
│   ├── for-cursor.md          # Cursor
│   ├── for-codebuddy.md       # CodeBuddy
│   ├── for-copilot.md         # GitHub Copilot
│   ├── for-antigravity.md      # Antigravity
│   └── for-qoder.md           # Qoder
├── agents/                    # 通用 Agent 库（清单见 agents/README.md；
│                              #   init/update 时安装到 .claude/agents/ 加载）
├── skills/                    # 可复用 Skill 库（清单见 skills/README.md；
│                              #   小程序项目 init 时安装 miniprogram-dev-skill 到 .claude/skills/）
├── contracts/                 # 跨仓契约目录（多仓 Workspace 模式用，见 09-多仓工作区指南.md）
└── ...
```

---

## 支持的工具

| 工具 | 配置文件 | 状态 |
|------|----------|------|
| Claude Code | `CLAUDE.md` | ✅ |
| Cursor | `.cursorrules` | ✅ |
| CodeBuddy | `AGENTS.md` | ✅ |
| GitHub Copilot | `.github/copilot-instructions.md` | ✅ |
| Antigravity | 配置文件 | ✅ |
| Qoder | 配置文件 | ✅ |

---

## 如果你是 AI

请按以下顺序执行：

1. 读取 `docs/AI配置指南.md`
2. 检测当前使用的 AI 工具类型
3. 根据指南同步对应配置文件
4. 确认配置生效

---

## 如果你是用户

首次打开项目后，告诉 AI：

```
> 请查看 docs/AI配置指南.md，按指南初始化项目
```

或者更简单：

```
> 初始化 AI 环境
```

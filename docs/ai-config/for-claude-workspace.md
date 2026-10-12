# CLAUDE.md（Workspace 产品级入口）

> SDD 开发脚手架 - 多仓工作区（Workspace 模式）入口配置
> 本文件由 SDD 脚手架生成，放在 workspace 根目录。CodeBuddy 项目将同样内容落为 `CODEBUDDY.md`。

---

## 这是一个多仓 Workspace

- **产品名**: {填写}
- **产品一句话定位**: {填写}
- 本目录是产品级真相源所在地，**不是**代码仓；成员代码仓是本目录的子目录

## 成员仓注册表

按以下优先级解析成员仓清单（AI 每次会话先读一遍）：

1. `.gitmodules`（submodule 布局）
2. `repos.md`（普通 clone 布局）

| 仓 | 路径 | 职责 | 技术栈 |
|----|------|------|--------|
| {示例：frontend-a} | `./frontend-a/` | {填写} | {填写} |

## 真相源分层（MUST）

| 内容 | 位置 |
|------|------|
| 跨仓需求 + 端到端验收标准 | `./SPEC.md`（产品级） |
| 仓间 API / 事件 / 共享模型契约 | `./docs/contracts/` |
| 各仓实现切面 | `<仓>/SPEC.md`（仓级，引用产品级条目号） |
| SDD 文档体系 / 工作流程 | `./docs/`（唯一一份） |

规则详见 `docs/09-多仓工作区指南.md`。

## 不可违反的约束

1. **先 SPEC，后代码**：跨仓需求必须先进产品级 SPEC，再拆解到仓级
2. **契约先行**：仓间接口变更先改 `docs/contracts/` 再改代码，任何一侧不得单方面绕过
3. **不复制真相源**：仓级 SPEC 引用产品级条目号，不复制跨仓需求正文
4. **（submodule 布局）不在日常执行 `git submodule update`**：成员仓代码以其工作区分支为准，指针只在版本验收/发布时 bump 快照

## 跨仓功能工作流

```
需求 → 产品级 SPEC 立项 → 拆解矩阵（涉及仓 × 交付物）→ 契约先行
     → 各仓 SPEC 展开 → 各仓开发 → 跨仓联调验收（+ 快照）
```

多 agent 分派可用 `.claude/agents/` 中的 project-orchestrator（通用）或 miniprogram-orchestrator（小程序）。

## 扩展能力

- **Agents**：已安装在 `.claude/agents/`（workspace 一份，全 workspace 可用），清单见 `docs/agents/README.md`
- **Skills**：见 `docs/skills/`

---

*本文档由 SDD 脚手架自动生成，按项目实际填写 {占位} 内容*

# Agents 目录

> SDD 脚手架自带的 Agent 库。所有 agent 定义**通用、不绑定具体项目**——项目特定的契约/约束通过项目自己的 CLAUDE.md / SPEC.md / overview 文档注入。

---

## 使用(安装与加载)

**分组按需安装**,不是全量:

| 分组 | 成员 | 安装策略 |
|------|------|---------|
| **core** | spec-docs-curator, project-orchestrator | init 默认安装 |
| **miniprogram** | miniprogram-orchestrator, miniprogram-ui-developer, miniapp-business-logic, wx-cloud-backend, miniprogram-map-developer | init 询问项目类型后选装 |
| **code-analysis** | static-code-analyzer, io-entry-mapper, dataflow-tracer, business-translator, fixture-validator | 同上 |
| **3d** | 3d-rendering-engineer, 3d-interaction-designer | 同上(通常与 code-analysis 组配套) |

- **Claude Code**:`/sdd-starter:init` 按上表安装到目标项目 `.claude/agents/`,自动加载(新会话生效);事后要加组,从 `docs/agents/` 复制对应文件即可
- **CodeBuddy**:agent 索引登记在项目根 `AGENTS.md`(按选中分组保留),定义正文在 `docs/agents/` 供引用
- 裁剪:直接删除 `.claude/agents/` 下不需要的文件(update 只刷新仍存在的同名文件,不会把删掉的加回来)

---

## 通用领域 Agents(跨项目复用)

这些 agent 定义的是**领域能力**,不绑定具体项目。被具体项目调用时,通过项目的 overview / SPEC 注入项目特定的契约与 schema。

| Agent | 能力 |
| ----- | ---- |
| [static-code-analyzer](./static-code-analyzer.md) | 静态代码分析:AST、符号表、调用图、框架识别 |
| [io-entry-mapper](./io-entry-mapper.md) | IO 入口识别:HTTP / 前端事件 / CLI / 队列 / cron |
| [dataflow-tracer](./dataflow-tracer.md) | 单入口数据流追踪(含 ORM / 跨进程边) |
| [business-translator](./business-translator.md) | 代码到中文业务语言的 LLM 翻译(evidence + 置信度) |
| [3d-rendering-engineer](./3d-rendering-engineer.md) | Three.js / R3F 3D 场景渲染与流水动画 |
| [3d-interaction-designer](./3d-interaction-designer.md) | 3D 空间内的导航、聚焦、防迷路 UX |
| [fixture-validator](./fixture-validator.md) | 测试夹具构建 + 端到端准确性回归 |
| [spec-docs-curator](./spec-docs-curator.md) | 规格与文档沉淀:需求抓取、SPEC 同步、真相源守护 |
| [project-orchestrator](./project-orchestrator.md) | 多 agent 项目主调度:任务拆解、契约注入、全局联调 |

---

## 微信小程序 Agents

面向微信小程序原生 + 云开发技术栈的分层开发 agent,按「UI / 业务逻辑 / 云端 / 地图」四个职责域拆分,由 orchestrator 统筹。

| Agent | 职责域 |
| ----- | ------ |
| [miniprogram-orchestrator](./miniprogram-orchestrator.md) | 小程序多 Agent 主调度:需求拆解、契约下发、全局联调 |
| [miniprogram-ui-developer](./miniprogram-ui-developer.md) | 视图层:页面、组件、弹窗、适配、UI 还原 |
| [miniapp-business-logic](./miniapp-business-logic.md) | 业务层:请求封装、微信能力对接、页面业务逻辑、数据流转 |
| [wx-cloud-backend](./wx-cloud-backend.md) | 云端:云函数、云数据库 schema/索引、云存储、安全规则 |
| [miniprogram-map-developer](./miniprogram-map-developer.md) | 地图:map 组件、定位 API、权限/隐私声明、坐标系、腾讯位置服务 |

**配套 skill**:选装本组时,init 会连带安装 [miniprogram-dev-skill](../skills/miniprogram-dev-skill/SKILL.md)(微信 DevTools 操作:预览/自动化截图/调试/云开发,经 `wechatide` CLI)——agent 负责写代码,skill 负责在 DevTools 里验证和操作,配合形成开发闭环。详见 `docs/skills/README.md`。

---

## 模板(不作为 agent 安装)

| 文档 | 用途 |
| ---- | ---- |
| [project-overview-template.md](./project-overview-template.md) | 多 agent 协作项目的项目层 overview 模板:角色映射、中间表示 schema、红线、里程碑路径 |

---

## Agent 编写规范

新增 agent 时创建 `docs/agents/{agent-name}.md`,格式:

```markdown
---
name: "agent-name"
description: "Use this agent when ...(英文触发描述 + 1-3 个 <example> 场景)"
---

(中文正文)
## 核心职责
## 严格的边界约束
## 工作流程
## 主动澄清原则
## 输出风格
```

要求:

1. **通用性**:不写具体项目的业务名词、字段、约束——那些属于项目的 SPEC / overview,由调用时注入
2. **边界明确**:写清楚"绝不做什么",与相邻 agent 的分工不重叠
3. **触发描述**:frontmatter 的 `description` 决定主 Agent 什么时候派活给它,例子要典型
4. **同步索引**:新增后把它加进本 README 的对应表格

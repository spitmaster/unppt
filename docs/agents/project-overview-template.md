# 项目层 Overview 模板(多 agent 协作项目)

> **这是一份模板文档,不是 agent 定义**——不会被安装到 `.claude/agents/`。
> 用途:当你的项目采用「通用领域 agent + 项目编排」双层架构时,复制本模板为 `docs/agents/<你的项目>-overview.md`,填入项目特定内容,供 `project-orchestrator` 与各领域 agent 读取。

---

## 双层架构:通用 agent + 项目编排

```text
┌──────────────────────────────────────────────────────────┐
│  项目层(每个项目自己写)                                  │
│                                                          │
│    <project>-overview.md — 本模板:角色映射、schema、红线 │
│    (orchestrator 由通用 project-orchestrator 承担,       │
│     读本文件注入项目契约)                                 │
│                                                          │
└──────────────────────────────────────────────────────────┘
                          ▼ 注入项目契约
┌──────────────────────────────────────────────────────────┐
│  通用领域 agent(跨项目复用,见 docs/agents/)              │
│                                                          │
│    static-code-analyzer       │  business-translator      │
│    io-entry-mapper            │  3d-rendering-engineer    │
│    dataflow-tracer            │  3d-interaction-designer  │
│    fixture-validator          │  spec-docs-curator        │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**关键原则**:

- 通用 agent 不知道你的项目是什么。它们等 orchestrator 下发任务时,从本 overview 读取项目的 schema 与红线
- 做新项目(代码可视化、代码搜索、重构辅助、API 文档生成……)时,**只写新项目的 overview**,复用同一批通用 agent
- **不要**改通用 agent 文件去满足单个项目的需求——项目特定需求通过 orchestrator 注入,通用 agent 保持通用

---

## 一句话定位(填写)

> 用 ≤3 句话说清:这个项目是什么、给谁用、差异化核心在哪。

---

## 通用 agent → 本项目角色映射(填写)

| 通用 Agent | 在本项目中的角色 | 产出(中间表示名) |
| ---------- | ------------------- | ---- |
| static-code-analyzer | 例:代码事实抽取 | 例:SymbolGraph |
| io-entry-mapper | 例:IO 入口识别 | 例:IOEntryRegistry |
| dataflow-tracer | ... | ... |
| business-translator | ... | ... |
| 3d-rendering-engineer | ... | ... |
| 3d-interaction-designer | ... | ... |
| fixture-validator | 例:夹具 + e2e 回归 | 夹具项目 + ground-truth + 报告 |

不用的 agent 删掉这一行;需要新领域能力时,先按 `docs/agents/README.md` 的规范新建通用 agent。

---

## 拓扑与数据流(填写)

画出本项目的 agent 拓扑:谁消费谁的产出、单向还是双向。建议原则:

- 数据层 agent 只产出结构化中间表示(JSON)
- 表现层 agent 只消费中间表示,不反向修改
- orchestrator 是唯一允许跨层协调的角色

---

## 中间表示 schema(填写)

通用 agent 等本文档定义具体 schema 后再开工。要求:

- 每个 schema 必须有显式 `schemaVersion`,变更需 orchestrator + 用户共同同意
- 跨 agent 引用的 ID 必须稳定可复现(推荐 `<lang>:<path>#<qualifiedName>` 风格)
- 不确定性字段统一用 `confidence: high | medium | low`

```json
{
  "schemaVersion": "0.1.0",
  "...": "在此为每个中间表示写出字段定义与示例"
}
```

---

## 红线(项目级架构不变量,填写)

任何 agent 动手前必须扫一眼。参考基线(按项目取舍/补充):

1. **数据层 agent 不允许直接生成表现层代码** — 必须产出中间表示
2. **AI 翻译/推断禁止臆造** — 只能基于已抽取的事实,evidence 为空拒绝采用,猜测必须标 `confidence=low`
3. **支持的语言/框架显式声明** — 不允许"尽力而为"地处理未声明支持的输入
4. **目标项目源码只读** — 任何 agent 都不允许修改用户输入的目标代码库
5. **中间表示有 schema 版本号** — agent 之间传递的 JSON 必须有版本号与 schema 校验,不允许临时字段

---

## 启动依赖顺序 / 里程碑路径(填写)

按阶段列出:先打通哪条主链路验证可行性,再扩展什么。建议:

- **阶段 1**:最小主链路端到端跑通(核心价值验证,配夹具与 ground-truth)
- **阶段 2**:表现层 / 体验完善
- **阶段 3**:扩展覆盖面(新语言/框架/场景,先建夹具再开发)

---

## 支持矩阵(填写)

| 维度(语言/框架/场景) | 状态 |
| ---- | ---- |
| 例:TypeScript + Express + Prisma | 阶段 1 目标 |

支持矩阵的扩展必须先建夹具,再开发 — 见 fixture-validator 红线。

---

## 与 SDD 体系的关系

本模板配合 SDD 脚手架使用:

- `SPEC.md` — 产品需求与验收标准(唯一真相源)
- `docs/` — 设计文档,沉淀中间表示 schema 与各 agent 在本项目的契约扩展
- 本 overview — agent 编排层的"协议文档",schema 详情可放设计文档、这里放索引

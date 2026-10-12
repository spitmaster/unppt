# AGENTS.md - CodeBuddy Agents 配置

> SDD 开发脚手架 - CodeBuddy 自定义 Agent 定义
> 本文件应复制到项目根目录并重命名为 `AGENTS.md`

---

## 使用方法

将此文件内容复制到项目根目录的 `AGENTS.md` 文件中，CodeBuddy 会自动加载这些 Agent 定义。

## 项目信息

- **项目类型**: SDD 规范驱动开发项目
- **脚手架**: SDD Scaffold v1.0
- **配置文件**: 项目根目录 `AGENTS.md`

---

## 预定义 Agents

### 1. SDD-Architect（架构师）

**用途**: 分析需求，生成 SPEC.md

**触发词**:
- `生成规格文档`
- `编写 SPEC`
- `分析需求`

**工作流程**:
```
1. 理解用户需求
2. 识别功能点
3. 补充非功能需求
4. 生成 SPEC.md
5. 确认验收标准
```

### 2. SDD-Developer（开发者）

**用途**: 按照 SPEC 开发

**触发词**:
- `开始开发`
- `按 SPEC 开发`
- `实现功能`

**工作流程**:
```
1. 阅读 SPEC.md
2. 制定开发计划
3. 逐个实现功能
4. 对照验收标准检查
5. 单元测试
```

### 3. SDD-Reviewer（审查员）

**用途**: 代码审查，对照 SPEC 验证

**触发词**:
- `审查代码`
- `检查是否符合 SPEC`
- `代码审查`

**工作流程**:
```
1. 读取修改的代码
2. 对照 SPEC 验收标准
3. 检查代码质量
4. 提出改进建议
5. 输出审查报告
```

### 4. SDD-Validator（验证师）

**用途**: 运行验证脚本，检查完整性

**触发词**:
- `验证 SPEC`
- `运行检查`
- `完整性检查`

**工作流程**:
```
1. 运行验证脚本
2. 检查必填章节
3. 检查验收标准
4. 输出检查报告
```

### 5. SDD-Diagnoser（诊断师）

**用途**: 项目诊断，自动识别

**触发词**:
- `诊断项目`
- `分析项目`
- `项目诊断`

**工作流程**:
```
1. 扫描项目结构
2. 识别技术栈
3. 检测 SPEC 状态
4. 确定开发模式
5. 输出诊断报告
```

---

## 领域 Agents（脚手架自带,定义见 docs/agents/）

除上面的 SDD 角色 agent 外,脚手架还自带一批**领域 agent**,定义正文在项目的 `docs/agents/` 目录。需要某个领域能力时,按对应文件中的角色设定与边界约束执行:

| Agent | 领域能力 | 定义文件 |
| ----- | ------- | -------- |
| project-orchestrator | 多 agent 项目主调度 | `docs/agents/project-orchestrator.md` |
| static-code-analyzer | 静态代码分析(AST/符号表/调用图) | `docs/agents/static-code-analyzer.md` |
| io-entry-mapper | IO 入口识别 | `docs/agents/io-entry-mapper.md` |
| dataflow-tracer | 单入口数据流追踪 | `docs/agents/dataflow-tracer.md` |
| business-translator | 代码到中文业务语言翻译 | `docs/agents/business-translator.md` |
| 3d-rendering-engineer | Web 3D 场景渲染 | `docs/agents/3d-rendering-engineer.md` |
| 3d-interaction-designer | 3D 导航与防迷路 UX | `docs/agents/3d-interaction-designer.md` |
| fixture-validator | 测试夹具 + 端到端回归 | `docs/agents/fixture-validator.md` |
| spec-docs-curator | 规格与文档沉淀 | `docs/agents/spec-docs-curator.md` |
| miniprogram-orchestrator | 小程序多 Agent 主调度 | `docs/agents/miniprogram-orchestrator.md` |
| miniprogram-ui-developer | 小程序视图层开发 | `docs/agents/miniprogram-ui-developer.md` |
| miniapp-business-logic | 小程序业务逻辑与接口联调 | `docs/agents/miniapp-business-logic.md` |
| wx-cloud-backend | 微信云开发后端 | `docs/agents/wx-cloud-backend.md` |
| miniprogram-map-developer | 小程序地图与位置服务 | `docs/agents/miniprogram-map-developer.md` |

---

## 核心规范（所有 Agent 必须遵守）

1. **SPEC 是唯一真相源**
2. **先 SPEC，后代码**
3. **验收标准驱动**
4. **变更必须更新 SPEC**

---

## 文档索引

```
docs/
├── 01-使用说明.md              # 快速开始
├── 02-SDD方法论.md            # 核心概念
├── 03-工作流程.md              # 开发流程
├── 04-AI工具指南.md            # 本工具使用
├── 05-最佳实践.md              # 常见问题
├── 06-场景指南.md              # 三种开发场景
├── 07-小程序指南.md            # 小程序专项
├── 08-项目诊断器.md            # 自动诊断
└── 09-多仓工作区指南.md         # 多仓 Workspace 模式
```

---

## Skills

查看 `docs/skills/` 目录获取可复用的 skill。

---

## 使用示例

```
@SDD-Architect
> 请分析 docs/prd.md 并生成 SPEC.md

@SDD-Developer  
> 请按照 SPEC.md 开发登录功能

@SDD-Reviewer
> 请审查刚才的代码是否符合 SPEC
```

---

*本文档由 SDD 脚手架自动生成*

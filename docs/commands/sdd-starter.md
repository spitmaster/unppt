# SDD 脚手架初始化

执行 SDD（规范驱动开发）脚手架初始化流程。

## 执行步骤

### 1. 检测当前环境

检查以下内容：
- 当前工作目录
- 是否已有 `docs/` 目录
- 是否已有 `olddocs/` 目录
- 是否已有 `.git` 仓库

### 2. 询问用户需求

询问用户：
```
是否需要迁移现有文档到 olddocs/？
- [1] 是，我有老项目文档需要迁移
- [2] 否，新项目直接使用
```

### 3. 执行脚手架注入

使用临时目录克隆脚手架（不影响当前项目 git）：

```bash
GIT_URL="https://github.com/spitmaster/sdd-starter.git"
BRANCH="main"
TEMP_DIR=$(mktemp -d)

git clone --depth 1 --branch $BRANCH $GIT_URL $TEMP_DIR
```

### 4. 复制文件

根据用户选择复制：
- `README.md` → 项目根目录
- `docs/` → 项目根目录（合并，不覆盖已有）
- `olddocs/` → 项目根目录（用户选择迁移时）

### 4.5 安装 Agent 库（Claude Code 项目）

若用户使用 Claude Code，按**分组**把 agent 定义安装到 `.claude/agents/` 使其被自动加载（分组清单见 `docs/agents/README.md`）：默认装 core 组（spec-docs-curator + project-orchestrator），询问项目类型后选装 miniprogram / code-analysis / 3d 组。

```bash
mkdir -p .claude/agents
AGENT_LIST="spec-docs-curator project-orchestrator <用户选中组的 agent 名>"
for name in $AGENT_LIST; do
  cp "$TEMP_DIR/docs/agents/$name.md" ".claude/agents/$name.md"
done
```

CodeBuddy 项目则通过 `AGENTS.md` 索引引用 `docs/agents/` 中的定义。

### 5. 清理

```bash
rm -rf $TEMP_DIR
```

### 6. 引导初始化

告诉用户：
```
✅ SDD 脚手架注入完成！

📁 已创建/更新：
- README.md
- docs/ 目录
- .claude/agents/（Claude Code 项目，新会话生效）

下一步请告诉 AI：
> 请初始化 AI 环境

或直接：
> 请查看 docs/01-使用说明.md
```

## 注意事项

- 使用临时目录克隆，不污染当前项目 .git
- 不覆盖用户已有内容
- 支持 Windows (PowerShell) 和 Mac/Linux (Bash)

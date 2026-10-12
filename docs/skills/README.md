# Skills 目录

> 存放可复用的 skill，AI 可直接调用

---

## 目录说明

本目录存放各种可复用的 skill，每个 skill 是一个独立的功能模块。

---

## 安装

无需单独安装：本目录随 `/sdd-starter:init` / `/sdd-starter:update` 一起复制到项目 `docs/skills/`，AI 按需读取调用。

---

## 新手入门

### 快速初始化 SDD 项目

```
告诉 AI：
> 初始化 SDD 项目

或：
> 注入 SDD 脚手架
```

AI 会自动从 GitHub 拉取脚手架并注入到当前项目。

详见：[sdd-init.md](./sdd-init.md)（说明文档：[sdd-init-README.md](./sdd-init-README.md)）

---

## 添加新的 Skill

创建新 skill 文件，命名规范：`{skill-name}.md`

```markdown
# {Skill 名称}

## 用途
描述这个 skill 是做什么的

## 触发词
- `使用 {skill}`
- `调用 {skill}`
- `{关键词}`

## 使用方法
描述如何使用这个 skill

## 示例
```
> {示例输入}
```

## 注意事项
使用时的注意点
```

---

## 现有 Skill

| Skill | 用途 | 触发词 |
|-------|------|--------|
| [sdd-init.md](./sdd-init.md) | ⭐ SDD 脚手架初始化 | `初始化 SDD 项目`、`注入脚手架` |
| [miniprogram-dev-skill/](./miniprogram-dev-skill/SKILL.md) | 微信小程序 DevTools 操作（预览/自动化/调试/云开发，经 `wechatide` CLI） | `预览到手机`、`截图看页面`、`查云函数`、`看小程序 console` |

### miniprogram-dev-skill 说明

- **形态**：目录型 skill 包（根 `SKILL.md` 负责环境检查与路由，`skills/` 下 7 个 scene：automator / debugger / cloudbase-operator / compiler / previewer / initializer / project-manager，工具注册表在 `miniprogram-tools/references/tools.yaml`）
- **安装**：小程序项目在 `/sdd-starter:init` 选装 miniprogram agent 组时连带安装——Claude Code 复制整包到 `.claude/skills/`（新会话自动加载）；CodeBuddy 直接按需读取本目录
- **前置依赖**：微信开发者工具的 `wechatide` 命令行（较新版本 DevTools 自带并注册系统 PATH；Windows Git Bash 找不到时用 PowerShell/CMD），且 DevTools 已扫码登录
- **版本**：包内 `skill.yaml` 记录版本；使用时 `check_devtools_status` 会与 DevTools 内置版本比对，不一致按提示更新

---

## Skill 模板

```markdown
# {Skill 名称}

## 用途

## 触发词

## 使用方法

## 示例

## 注意事项
```

复制模板创建新 skill：`docs/skills/{你的skill名称}.md`

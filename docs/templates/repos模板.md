# repos.md - 成员仓注册表

> 普通 clone 布局（非 submodule）的 workspace 用本表登记成员仓。
> submodule 布局无需本文件——`.gitmodules` 就是注册表。
> 复制本模板到 workspace 根目录并重命名为 `repos.md`。

---

## 成员仓清单

> 路径为相对 workspace 根的路径；成员仓目录应加入 workspace 的 `.gitignore`。

| 仓名 | 路径 | Git 地址 | 职责 | 技术栈 | 主分支 | 接入级别 |
|------|------|----------|------|--------|--------|---------|
| {frontend-a} | `./frontend-a/` | {git@...} | {C 端页面} | {Vue3} | main | 受控 |
| {backend-a} | `./backend-a/` | {git@...} | {订单服务} | {Java/Spring} | main | 外部 |

> **接入级别**：受控 = 本团队开发，落薄入口、契约先行；外部 = 其他团队开发，零侵入，主仓靠 `/sdd-starter:digest` 摘要了解它（详见 `../09-多仓工作区指南.md`）。

## 克隆指引

```bash
# 在 workspace 根目录逐仓克隆（按上表路径）
git clone {git@...frontend-a} frontend-a
git clone {git@...backend-a} backend-a
```

## 维护规则

- 新增/移除成员仓时更新本表，并同步 workspace `CLAUDE.md` 的注册表节
- 路径只用相对路径，不写机器相关的绝对路径

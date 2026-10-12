# repos/ - 成员仓摘要目录（派生文档）

> Workspace 多仓模式下，各成员仓代码现状的**派生快照**。单仓项目用不到本目录。

---

## 安装

无需单独安装：本目录随 `/sdd-starter:init` / `/sdd-starter:update` 复制到 workspace 的 `docs/repos/`。

---

## 使用

- 运行 `/sdd-starter:digest`（可指定仓）后，每个成员仓生成一份 `<仓名>.md` 摘要（格式见 `../templates/仓摘要模板.md`）
- 每份摘要的 frontmatter 带 `source_commit` + `synced_at`——**读者据此判断新鲜度**
- **真相源永远是子仓代码**：摘要与代码冲突时以代码为准；需要最新视图时重新 digest
- 本目录文件由 digest 命令维护，不建议手工编辑正文（会在下次同步时被合并处理）

## 与其他目录的关系

| 目录 | 时态 | 谁写 |
|------|------|------|
| `../contracts/` | 现在时（仓间接口的约定，先于代码） | 人（契约先行决策） |
| 本目录 | 快照（代码现状的总结，晚于代码） | `/sdd-starter:digest` |
| 产品级 `SPEC.md` | 现在时（产品需求真相源） | 人 |

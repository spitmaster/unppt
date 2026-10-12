# Git 分支与版本管理规范

> 本规范解决一个核心问题：**让任何人随时能看出「哪个 feature 属于哪个版本」**。

---

## 一、核心理念

| 手段 | 解决什么 | 生命周期 |
|------|----------|----------|
| **分支名** | 开发期"看得见"——一眼知道某改动属于哪个版本 | 临时，发布后删除 |
| **git tag + CHANGELOG** | 永久追溯——feature ↔ version 关联的**权威真相源** | 永久 |

两者配合，缺一不可。分支会删，所以"哪个 feature 进了哪个版本"的最终答案永远以 **tag + CHANGELOG** 为准。

---

## 二、版本号语义（SemVer `A.B.C`）

| 段 | 含义 | 何时递增 |
|----|------|----------|
| **A** 大版本 (major) | 破坏性变更 / 重大重构 | 不兼容旧用法时 |
| **B** 特性版本 (minor) | 新增功能 | 加 feature 时 |
| **C** bug修复版本 (patch) | 修 bug | 仅修复时 |

- 一个特性版本（B）通常**打包多个 feature** 一起发布。
- 递增哪一段由**发布时**实际决定，不由分支类型强制。

---

## 三、`v` 前缀规则

> **记忆法：机器读的不带 v，发布盖章带 v。**

| 位置 | 写法 | 示例 |
|------|------|------|
| 分支名 | 不带 v | `feature/1.2.1/dingding-notify` |
| `plugin.json` 的 `version` | 不带 v | `1.2.1` |
| git tag | **带 v** | `v1.2.1` |

依据：SemVer 规范规定版本号本身是 `1.2.3`（不含 v）；`v` 只是版本控制里给 tag 加的标记前缀。元数据字段（npm / Cargo 等）强制纯 semver；tag 带 v 是 Linux / Git / Node / Kubernetes / Go 等主流项目的多数派惯例（Go modules 甚至强制要求 tag 带 v）。

---

## 四、主干分支兼容：`<trunk>`

本规范全文的 `<trunk>` = **本仓库的默认分支**，可能是 `main`、`master` 或其他——**不写死名字**。执行分支操作前先探测真实名字：

```bash
# 首选：远端 HEAD 指向的默认分支
git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@'
# 兜底（远端 HEAD 未设置时）：
git remote show origin | sed -n '/HEAD branch/s/.*: //p'
```

> ⚠️ 凡是规范/脚本里要引用主干分支处，一律用探测结果，**禁止写死 `main`**——否则在 `master` 仓库会卡死。

---

## 五、分支模型（一条主干 + 临时版本分支，不引入 develop）

```
              ┌─ feature/1.2.1/xxx ─┐
<trunk> ──────┤                     ├──▶ release/1.2.1 ──(测试OK)──▶ tag v1.2.1
(main/master) └─ feature/1.2.1/yyy ─┘                                    │
     ▲                                                                   │
     └──────────── 回流 <trunk> + 删除 release/1.2.1 ◀────────────────────┘
```

- **`<trunk>`**：永远等于"最新已发布的稳定版"，别人 clone 拿到的就是能用的版本。**永不删**。
- **`release/A.B.C`**：某个版本的"集结地"，临时存在，发布后删除。
- **不引入 `develop`**：`release/A.B.C` 本身已充当该版本的半成品集结地。团队规模/并行版本变多时再考虑引入。

---

## 六、分支命名规则

### 格式

```
<type>/<version>/<slug>
```

### type 枚举

| type | 用途 | CHANGELOG 分类 |
|------|------|----------------|
| `feature` | 新功能 | Added |
| `fix` | 非紧急 bug 修复 | Fixed |
| `hotfix` | 生产紧急修复 | Fixed |
| `refactor` | 重构，行为不变 | 可选 |
| `docs` | 纯文档 | — |
| `chore` | 构建 / 依赖 / 杂项 | — |

### 各段规则

- **`<type>`**：只表达"改动性质"，**不绑定版本递增位**——`feature/1.2.1/x`（feature 进 patch 版）也合法。
- **`<version>`**：该分支计划合入的目标版本，任意 `A.B.C` 合法；版本还没定时写 `next`（如 `feature/next/xxx`），定了之后**不改名**，最终归属以 tag/CHANGELOG 为准。
- **`<slug>`**：kebab-case、全小写、英文、2–4 词、语义化。
  - ✅ `dingding-notify`、`clone-depth-bug`
  - ❌ `fix1`、`update`（无信息量）、`新功能`（非英文）
- `refactor` / `docs` / `chore` 不绑定版本时可省略版本段：`refactor/skill-loader`。

### 示例

```
feature/1.2.0/dingding-notify      # 1.2.0 要加的钉钉通知功能
feature/1.2.0/multi-lang-spec      # 同一个 1.2.0 版本的另一个 feature
fix/1.2.1/clone-depth-bug          # 1.2.1 补丁版修的 bug
feature/1.2.1/quick-filter         # feature 进 patch 版，合法
hotfix/1.1.2/broken-install        # 生产紧急修复
feature/next/experimental-graph    # 版本还没排定
refactor/skill-loader              # 重构，不绑定版本
```

---

## 七、标准开发流程（SOP）

```bash
# 0. 探测主干分支名（main / master）
TRUNK=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')

# 1. 规划：决定 1.2.1 版本要做哪些 feature，从主干建版本分支
git checkout "$TRUNK" && git pull
git checkout -b release/1.2.1

# 2. 每个 feature 从 release/1.2.1 拉分支开发
git checkout -b feature/1.2.1/dingding-notify release/1.2.1
#    …开发、提交（commit 建议用 conventional：feat: / fix: …）…

# 3. feature 完成，合回 release/1.2.1，删 feature 分支
git checkout release/1.2.1 && git merge --no-ff feature/1.2.1/dingding-notify
git branch -d feature/1.2.1/dingding-notify

# 4. 版本集齐 + 测试通过 → 准备发布：bump 版本号 + 写 CHANGELOG
#    改 plugin.json "version": "1.2.1"，更新 CHANGELOG.md

# 5. 合回主干，打 tag（顺序固定：先合 → 先 tag → 后删）
git checkout "$TRUNK" && git merge --no-ff release/1.2.1
git tag v1.2.1                      # ← tag 必须在删分支之前
git push origin "$TRUNK" --tags

# 6. tag 确认存在后，删除 release 分支
git branch -d release/1.2.1
git push origin --delete release/1.2.1
```

### hotfix 旁路（已发布版本的生产紧急修复）

从出问题的 **tag** 拉，不从主干拉：

```bash
git checkout -b hotfix/1.2.2/broken-install v1.2.1   # 从 tag 拉
#    …修复…
git checkout "$TRUNK" && git merge --no-ff hotfix/1.2.2/broken-install
git tag v1.2.2 && git push origin "$TRUNK" --tags
git branch -d hotfix/1.2.2/broken-install
```

---

## 八、分支删除规则（含安全护栏）

| 分支 | 处置 | 时机 |
|------|------|------|
| `feature/*` | 删 | 合回 release 之后 |
| `release/*` | 删 | **必须先打 tag、确认 tag 存在后才能删** |
| `hotfix/*` | 删 | 合回主干 + 打 tag 之后 |
| `<trunk>` | **永不删** | — |

- **硬约束**：删 `release/*` 前 `git tag` 必须已成功。tag 是永久不可变锚点，保证删分支**不丢任何 commit**（内容已进主干历史 + 被 tag 钉死）。
- 删除是为了避免"已发布的死分支堆积"——这正是本规范要根治的"分支多到分不清"。
- 旧版本要补丁：从 **tag** 拉新分支（`git checkout -b hotfix/x.y.z vA.B.C`），不依赖留着旧 release 分支。

---

## 九、tag 与 CHANGELOG（永久追溯）

- **每次发布必打 tag** `vA.B.C`，并同步 `plugin.json` 的 `version`。
- **维护 `CHANGELOG.md`**（可用 `docs/templates/变更日志模板.md`）：按版本分节，每条 feature / fix 一行。这是事后查"哪个 feature 进了哪个版本"的权威来源。
- 反查命令：`git tag --contains <commit>` → 某次改动进了哪个版本。

---

## 十、反模式

| ❌ 反模式 | ✅ 正确做法 |
|----------|------------|
| 直接在 `<trunk>` 上提交开发代码 | 一律走 `feature/*` → `release/*` |
| 写死 `main`，在 master 仓库卡死 | 用 `<trunk>` + 探测命令 |
| 分支名带 v（`feature/v1.2.1/x`） | 分支不带 v，只 tag 带 v |
| 删了 release 才发现没打 tag | 先 tag、确认存在、再删 |
| 发布完留着一堆 `release/*` | 发布后删除 |
| slug 无信息量（`fix1` / `update`） | 语义化 kebab-case |

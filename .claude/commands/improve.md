---
description: 跑一轮自动优化：比对 → 找影响最大的一类问题 → 合成中性用例 → 修代码 → 验收 → 提交
---

# 自动优化一轮（SPEC 5.4）

先读 CLAUDE.md 的「不可违反的规则」。**样本安全**：可以查看样本截图和文字来调试（用户已放开），但样本内容不能进仓库、提交信息、文档、testcases；要固定成用例只能用 PowerPoint 合成中性内容。

## 步骤

1. **准备**：关闭自己打开的 PowerPoint，然后
   ```bash
   .venv/Scripts/python tools/powerpoint/export.py run          # 新样本导出参考图
   .venv/Scripts/python tools/compare/run.py --set daily         # 比对
   .venv/Scripts/python tools/compare/clusters.py                # 失败原因排行（只有数字）
   ```
2. **选目标**：取排行里影响页数最多的一类。需要更细的数字时：
   - `tools/compare/offsets.py 编号`：逐行文字的位置偏差；
   - 读 `.cache/report/results.json` 里该类形状的 `box`、`region`、`refLines/ourLines`、`refBoxes/ourBoxes`；
   - 只允许打印格式属性（去掉 `<a:t>` 文字、去掉 `name=` 属性），不打印文字和图片。
3. **合成用例**：在 `tools/make-case/make.py` 加一个函数，用 PowerPoint 造出**同一特征**、内容中性的用例，然后
   ```bash
   .venv/Scripts/python tools/make-case/make.py 用例名
   .venv/Scripts/python tools/powerpoint/export.py run --set testcases --only 用例名
   .venv/Scripts/python tools/compare/run.py --set testcases --only 用例名
   ```
   确认它在我们这边确实有问题（合成用例可以看图：`.cache/report/img/tc-用例名-*`）。
4. **修代码**：只改 `packages/` 下的产品代码。不改比对工具、阈值或参考图来刷分；必须改时停下来找人。
5. **验收**（全部满足才算完成）：
   - 新用例分数提升；
   - `--set testcases` 没有任何页面比之前低超过 0.005；
   - `--set daily` 总通过数不减少，没有之前通过、现在不通过的页面；
   - `npm test` 和 `tools/check-player.py` 通过。
6. **提交**：提交信息写修了哪一类问题、分数变化，**不写任何样本信息**（文件名、文字、哈希以外的标识）。

## 停下来找人的情况

- 连续 3 轮分数没有提升；
- 需要改比对工具、阈值、参考图，或改产物格式；
- 怀疑 PowerPoint 参考图本身有问题。

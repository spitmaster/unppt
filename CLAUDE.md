# CLAUDE.md

> 给 Claude Code：**先读 [SPEC.md](SPEC.md) 再动手**。SPEC 是需求真相源。
> 本项目遵循 SDD（Specification-Driven Development）规范，见 [docs/](docs/)。

---

## 第零步：看当前进度

1. `git branch --show-current` 拿到分支名；
2. 如果存在 `docs/milestones/<分支>.md`、`docs/todo/<分支>.md`（分支名里的 `/` 换成 `_`），先读它们；
3. 先看 `SPEC.md` 的「已确认的决策」和「仍待定的事项」，避免踩到还没定的地方；
4. 当前分支是 `main` 时，如果要开发新功能，先确认是否要切分支。

---

## 项目一句话定位

unppt：把 .pptx 转成静态产物（SVG + JSON + 资源），由一个可 iframe 嵌入、可被外部控制的播放器播放，效果对齐 Microsoft PowerPoint。转码器是可以放进云函数的纯函数，播放器是浏览器 JS，两者只通过产物格式耦合。

---

## 不可违反的规则（[MUST]）

1. **样本安全**：`samples/` 里可能有客户 PPT。样本及其衍生物（参考图、截图、报告、提取的文字、文件名）**绝不能**进仓库、提交信息、文档、`testcases/`，也不能发到任何网络服务。报告里样本用内容哈希表示。调试时可以查看样本的截图和文字（用户 2026-10-14 放开；内容会经过 AI 模型接口，但仍然不能写进上面这些地方，也不能发到其它网络服务）。要把问题固定成测试用例，只能用 PowerPoint 重新合成中性内容的用例。完整规则见 SPEC 第 4 节。
2. **产品代码不依赖环境**：`packages/` 下可以用纯 JS 和 WASM 类库（用户 2026-10-15 放开），**不能用原生插件（要编译的 npm 包）和外部程序**；新类库要注明许可证、固定版本；播放器仍然零依赖。开发工具（`tools/`）不受这条限制。
3. **核心渲染自研**：正式播放的渲染自研；第三方渲染项目可以在评测里作为对比、用在缩略图这类周边功能（见 SPEC D6），不能复制它们的代码。
4. **转码器是纯函数**：字节进、文件出，不读写磁盘、不联网；字体只接收字节。
5. **不刷分**：评测工具、阈值、参考图由 agent 自己决定怎么改（用户 2026-10-14 授权："测试随你，只要产物不乱搞"），但改测试是为了让测量更准，不能为了让分数好看；改了已有参考图或阈值，在提交信息和 docs/todo 里写明原因。
6. **架构（SOLID）**：加新能力优先走扩展点（新文件 + 注册表一行），不往大文件、大 `switch` 里堆；模块只依赖下层和窄接口。扩展点和分层见 [docs/architecture.md](docs/architecture.md)，分层规则由 `scripts/check-deps.mjs` 在 `npm test` 里自动检查。
7. **架构图随代码迭代**：改了模块结构、加了扩展点，**同一个提交**里更新 `docs/architecture.md` 的图和表。
8. **重构不改行为**：纯重构前 `node scripts/golden.mjs save`，改完 `node scripts/golden.mjs check` 必须逐字节一致（播放器重构只允许"内嵌播放器"一项变化，并且 `tools/check-player.py` 在 Chrome、Firefox 都通过）。

---

## 关键目录速查

| 目录 | 职责 |
|------|------|
| `packages/format` | 产物格式规范（类型 + Schema + 版本号） |
| `packages/transcoder` | 转码器（TS，零依赖） |
| `packages/player` | 播放器（TS，零依赖） |
| `tools/powerpoint` | 调本机 PowerPoint 导出参考图、放映截图对照页面切换（Python + pywin32） |
| `tools/make-case` | 用 PowerPoint 生成合成测试用例 |
| `tools/compare` | 截图、比对、打分、出报告（Python + Playwright） |
| `testcases/` | 测试用例 + 参考图（无客户内容，可提交） |
| `scores/summary.json` | 按特征汇总的分数（可提交） |
| `samples/` | 样本库（gitignore，只在本机） |
| `.cache/` | 参考结果、截图、报告（gitignore） |
| `docs/` | SDD 方法论与流程文档 |

---

## 自动优化循环

按 SPEC 5.4 执行：从错题排行榜取最前面的一类 → 看样例定位 → 合成中性复现用例、实测规则 → 修产品代码 → 验收 → 提交。用户的上万份真实课件按 SPEC 第 4 节和 5.2 处理：分批导出、内容绝不外泄、不发给微软。不要过度设计：只做眼下需要的。

---

## 开发规范

### Git Commit

- 适时提交并推送：每完成一个能独立验证的小步（重构、一个功能点）就提交，不要攒成一个大提交；
- 提交信息前缀：`feat:` `fix:` `docs:` `refactor:` `test:`；
- 测试和评测通过后再提交；
- 提交信息里**不能出现任何样本信息**。

### 代码规范

- 新功能先更新 SPEC.md，再动手；
- 保持简单，不提前引入用不到的东西；
- 一个文件一个职责，超过约 300 行就考虑拆；`tsconfig` 开了 `noUnusedLocals` / `noUnusedParameters`，不留无用代码；
- 实测得到的 PowerPoint 规则写进 SPEC 第 7 节，代码里的校准常数注明"实测"和依据；
- 多人协作的约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。

---

## 测试 / 评测

```bash
npm run build                                         # 构建
npm test                                              # 单元测试
.venv/Scripts/python tools/compare/run.py --set testcases   # 合成用例比对（可以看图）
.venv/Scripts/python tools/compare/run.py --set all         # 样本比对（只看数字）
.venv/Scripts/python tools/compare/offsets.py 编号          # 逐行位置偏差（数字）
.venv/Scripts/python tools/compare/sweep_ab.py run 目录 --cli old=旧cli.js,--system-fonts --cli new=packages/transcoder/dist/cli.js,--system-fonts  # 全量课件逐页 A/B（发版前）
.venv/Scripts/python tools/compare/corpus_report.py --results 目录 --base-dir 上一版目录 --version x.y.z  # 生成测试报告 docs/zh|en/test-report.md（只有汇总数字）
.venv/Scripts/python tools/check-player.py [firefox]        # 播放器端到端测试
.venv/Scripts/python tools/check-paged.py                   # 按需加载形式和单文件逐页、逐步对照
.venv/Scripts/python tools/check-live.py                    # 直播课：演绎模式、观看模式和同步
.venv/Scripts/python tools/powerpoint/transitions.py capture FadeSmoothly,PushLeft  # 放映截图
.venv/Scripts/python tools/powerpoint/transitions.py capture-anim Fly:Left,Exit:Fade  # 动画放映截图
.venv/Scripts/python tools/powerpoint/transitions.py compare                        # 切换/动画逐帧对照
```

新增或修改测试用例：`tools/make-case/make.py` 加函数 → `make.py 用例名` → `tools/powerpoint/export.py run --set testcases --only 用例名`。

---

## 沟通约定

- 语言：中文。

---

*本文件基于 sdd-starter 脚手架（v1.4.0）的 `docs/ai-config/for-claude.md` 生成，已按项目定制。*

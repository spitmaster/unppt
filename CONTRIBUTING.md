# 参与开发

先读 [docs/architecture.md](docs/architecture.md)（架构图、分层、扩展点），再读 [SPEC.md](SPEC.md)（需求和实测规则）。

## 原则：加功能不改别人的代码

代码按 SOLID 组织，目标是多人同时开发时很少碰到同一个文件：

- **加一种能力 = 加一个文件 + 在注册表里加一行。** 已有的扩展点：

  | 想加 | 新建 | 注册 |
  |---|---|---|
  | 一种图片格式（转码时转换） | `transcoder/src/media/xxx.ts`（`ImageDecoder`） | `media/decoders.ts` |
  | 一种形状效果 | `transcoder/src/effects/xxx.ts`（`ShapeEffect`） | `effects/effects.ts` |
  | 一种 graphicFrame 内容 | `transcoder/src/render/frames/xxx-frame.ts`（`FrameHandler`） | `render/frames/frames.ts` |
  | 一种图表 | `transcoder/src/chart/types/xxx.ts`（`ChartType`） | `chart/chart-types.ts` |
  | 一种进入/退出动画效果 | `player/src/anim/effects/xxx.ts`（`AnimEffect`） | `anim/effects/effects.ts` |
  | 一种页面切换 | `player/src/transitions/xxx.ts`（`TransitionEffect`） | `transitions/transitions.ts` |
  | 一种产物形式 | `transcoder/src/output/xxx.ts`（`OutputForm`） | `output/forms.ts` |

  需要的扩展点还不存在时，先单独提一个"加扩展点"的重构（行为不变），再在上面加功能。
- **一个文件一个职责**，超过约 300 行就考虑拆。
- **只依赖下层和窄接口**：分层规则在 `scripts/check-deps.mjs`，`npm test` 会检查，违反就失败；不允许循环依赖。
- **产品代码不用原生插件和外部程序**：`packages/` 下只能用纯 JS 和 WASM 类库，新类库注明许可证、固定版本（清单见 `packages/transcoder/THIRD-PARTY-NOTICES.md`）；播放器零依赖。

## 两类改动，两种验收

| 改动 | 怎么证明没改坏 |
|---|---|
| **重构**（行为不该变） | 改之前 `node scripts/golden.mjs save`，改完 `node scripts/golden.mjs check` 必须逐字节一致。播放器重构只允许"(内嵌播放器)"一项变化，并且 `tools/check-player.py`（Chrome）和 `tools/check-player.py firefox` 都通过。 |
| **行为改动**（修 bug、加功能） | 用 PowerPoint 合成一个中性测试用例（`tools/make-case/make.py`），导出参考图，比对分数提升；`--set testcases` 没有任何一页变差超过 0.005；样本集通过数不减少；`npm test`、`tools/check-player.py` 通过。 |

不要把重构和行为改动混在一个提交里——前者可以被逐字节验证，混在一起就验证不了。

## 提交前检查

```bash
npm run build
npm test                                   # 单元测试 + 架构守门
node scripts/golden.mjs check              # 重构时
.venv/Scripts/python tools/compare/run.py --set testcases
.venv/Scripts/python tools/check-player.py
.venv/Scripts/python tools/check-player.py firefox
```

- 提交信息前缀：`feat:` `fix:` `refactor:` `docs:` `test:`；写清楚改了什么、分数怎么变。
- 改了模块结构或扩展点，**同一个提交**里更新 `docs/architecture.md`。
- 用 PowerPoint 实测得到的规则写进 SPEC 第 7 节，代码里的校准常数注明依据。
- **样本安全**：`samples/` 里可能有客户文件，样本的任何内容（文件名、文字、截图）都不能进仓库、提交信息或文档。

## 分支

`main` 放文档，开发在 `dev`；一个需求一个分支，从 `dev` 拉（`git switch -c 分支名 origin/dev`），首次推送用 `git push -u origin 分支名`。

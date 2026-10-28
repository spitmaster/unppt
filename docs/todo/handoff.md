# 交接文档：未完成的工作怎么接（2026-10-28）

> 写给接手的 agent（或开发者）：**不用看之前的对话**，按这份文档就能接上。
> 先读 [CLAUDE.md](../../CLAUDE.md)（规则）和 [SPEC.md](../../SPEC.md)（需求真相源），再读这份。

## 0. 现状一句话

- **0.3.2 已发布**（v0.3.2 标签，GitHub Release；npm 的 latest 是否已变成 0.3.2 见第 1 节）。dev 和 main 在同一个提交之后只多了几篇文档。
- 代码主线是 `dev`（日常）和 `main`（只收发布）。全量课件比对：5212 份真实课件 168662 页，转码失败 0，平均相似度 0.965，78.5% 的页达到 0.95，详见 [测试报告](../zh/test-report.md)。
- 下面是**没做完的事**，按优先级排。

## 1. 先确认：0.3.2 在 npm 上出来了吗

打 tag 后 GitHub 工作流（`.github/workflows/release.yml`）会自动把包发到 npm（可信发布），npm 处理要几分钟到半小时。

```bash
npm view @unppt/unppt dist-tags --registry https://registry.npmjs.org/ --prefer-online
```

- 显示 `latest: '0.3.2'`：已发布，什么都不用做。
- 还是 `0.3.1`：到 GitHub 仓库 Actions，看 v0.3.2 那次运行的"发布到 npm"步骤有没有 `+ @unppt/unppt@0.3.2`。有就是 npm 还在处理；报错就按报错处理。
- **不要手动发**：npm 处理期间手动发会报 409。npm 同一个版本号只能发布一次，不能撤回重发（0.3.0 就是这么废掉的）。
- npm 登录、验证码只能由项目所有者做，agent 不要碰密码、令牌。

## 2. 待验收的分支（已写好代码，没验收）

5 个分支在 GitHub 上有备份（`origin/fix/<名字>`），每个修复的原因都查清了、代码写好了，**差验收**。没提交的半成品存成补丁在本机 `.cache/wip-patches/<名字>.patch`（不进仓库，可能已不在；没有就算了，已提交的部分是完整的）。

| 分支 | 已提交的修复 |
|---|---|
| `fix/chart` | 图表文字里的主题字体引用（`+mj-ea`、`+mj-lt`、`+mn-ea`）和正文一样解析（雅黑以前被画成黑体 / 等线）；数值轴有负数时最小值留 5% 余量再取整；图表文字行高随字体变（标题框、分类标签带、图例带）；合成用例 `charts-font-theme-refs` |
| `fix/textline` | 行距小于单倍时基线不再一直往上扣；虚线边框从闭合线段起点开始排；艺术字包络类的外框算上空段落；组合里的图案填充按幻灯片原点平铺；形状效果滤镜区域按实际轮廓（标注尾巴不再被裁）；小字人工加粗有下限 |
| `fix/smartart` | SmartArt 文字行高按字体度量算；绘图缓存和数据模型对不上（WPS 存的文件）时没有节点的不画、字对不上的提示 |
| `fix/emf` | EMF 的 STRETCHDIBITS 按 PowerPoint 的画法（源框按比例对到目标框、位图偏半个像素、露出的部分补镜像像素）；WMF 图案画刷按平均色填（以前剪贴画画成黑色剪影） |
| `fix/pie` | 复合饼图、复合条饼图画数据标签，有外侧标签时饼缩小 |

### 怎么验收一个分支（每个都这样做）

```bash
# 1. 建工作区（别在主仓库里切分支）；复制依赖，不要用目录链接（删 worktree 时会误删主仓库的数据）
git worktree add ../unppt-wt-<名字> fix/<名字>
cp -r node_modules ../unppt-wt-<名字>/
cp -r packages/fonts/files ../unppt-wt-<名字>/packages/fonts/    # 开源字体文件不进 git

# 2. 一条命令：变基到 dev（自动解决 tools/make-case/make.py 的用例列表冲突）、构建、单元测试、
#    合成用例全集对基线（任何一页下降超过 0.005 就不合并）；加 --merge 才真合并（不推送）
.venv/Scripts/python tools/dev/land.py ../unppt-wt-<名字> --baseline <合成用例基线>.json --merge
```

- 合成用例基线：`python tools/compare/run.py --set testcases` 之后复制 `.cache/report/results.json`（要在 PowerPoint 能用的机器上，参考图在 `testcases/` 里已有，比对本身不需要 PowerPoint）。
- 通过后还要用真实课件抽样确认有提升、没有副作用（见第 6 节的比对工具）；改了排版、字体、整页图的，发版前必须跑**全量比对**（`docs/release.md`）。
- 另有 **只提交、没有合成用例**的修复：补一个中性内容的用例（`tools/make-case/make.py` 加函数 → 用 PowerPoint 生成 → `export.py`）再合并，规则见 CLAUDE.md。
- 其中 **某些规则是推测、没有用 PowerPoint 实测**的，要先实测（COM 探针，见第 6 节），实测得到的规则写进 SPEC 第 7 节。

## 3. 调研路线图（五条产品要求）里没做的

产品五条要求：**R1 转码快、R2 播放一致且适配各种屏幕、R3 播放性能、R4 排版一致（字体可以不同）、R5 动画和媒资一致**。
调研只做了两个方向，结果见 [路线图](../zh/research/roadmap-2026-10-26.md)（12 项，带证据和做法）：

**已做完的**：舞台位移取整到设备像素；空格进字体子集、字体列表不写原字体名（都在 0.3.2）。

**调研里已经测出来、还没做的（按影响排）**：

1. 放不了的媒体要能被发现、被提示（13.4% 带媒体的课件有浏览器放不了的视频 / 音频；现在转码不报警、播放器不报错）。
2. 动画行为解释器的一个顺序 bug（`compileBehaviors` 里 visibility 的判断放在 `timingOf` 之后，843 个效果退回旧画法）——小改动，收益大。
3. 默认的按需加载形式：等这一页的字体到齐再显示（慢网下首屏先闪一下观看者的系统字体）。
4. 补齐行为解释器（强调、路径、闪烁、彩色打字机等，约 1291 个效果动得不对）。
5. 页面切换的几件小事（时长被 3 秒截断、`random` 切换退成淡入、版式母版继承是否生效没验证）。
6. 缩小显示时细线变淡（和 PowerPoint 规则相反）；强制深色模式下页面变色；手机竖屏小字。
7. MP4 改成 faststart（52% 的视频 moov 在文件尾）；EMF/WMF 图片里的文字用了观看者的字体（大工程）。

**调研里还没测的四个方向**（当时被额度打断，没出结果）：转码速度（耗时分布、各阶段占比、峰值内存）、播放性能（首屏、翻页延迟、低端手机帧率）、排版与字体无关（默认字体包和本机字体两种模式的换行是否一致——可以做成自动检查）、测试盲区（哪些东西没被测到，该加什么自动门禁）。做法见 [CLAUDE.md](../../CLAUDE.md) 的评测命令；**优先用脚本**，不要靠逐页看图。

## 4. 其他没做完的小事

- **转码速度**：0.3.2 的整页图质量修复让转换平均慢了约 10%（图片多的课件最多约 30%）；多线程时每个线程各自缩放同样的图片，可以共享缩小后的结果（`preview/fit-images.ts`）。
- **默认字体包模式下少数字形差异**：符号替代表见 [glyph-overrides.md](../zh/research/glyph-overrides.md)，用 `python tools/fonts/glyph_audit.py` 重新生成；字体包里找不到画法接近的符号，要往字体包补字形（需要发新版 `@unppt/fonts`）。
- **两条没用 PowerPoint 实测的换行规则**：`eaLnBrk="0"` 且韩文 altLang 的段落，句号逗号是否悬挂；两种字体都没有的不换行空格（NBSP）按谁的宽度排（现在按 Calibri，参考图像是半个字宽）。见 [回退调研](../zh/research/regressions-0.3.md)。
- **图片缩小略糊**：清晰截图缩小后比 PowerPoint 略软。试过 Lanczos 抽样：没有明显提升，没采用。
- **文字变形的合成用例**：圆形文字"换行开着、长文字"的情况没有专门的测试用例，补一个。
- **`--output single` 配 `-o out` 会写出一个叫 `out`（没有 `.html`）的文件**；`--no-system-fonts` 会取消前面的 `--system-fonts`，文档说"无效果"。
- **npm 页面的英文说明**已改好，要到下一次发布才会出现在 npm 上。
- **GitHub Pages 演示站**：<https://spitmaster.github.io/unppt/>，改完内容 `npm run site && npm run site:publish`。

## 5. 要所有者定的事（agent 不要自己决定）

- 是否继续做第 2、3 节的哪些项、先后顺序。
- 是否重写 git 历史去掉提交信息里的署名行（`Co-Authored-By: AI-SDLC …`）：会改掉近 600 个提交，需要强制推送，规则禁止；所有者说"先这样"，**不要动**。署名来自公司 Claude 组织的统一设置，不是项目本身的要求。
- 在线转换页（浏览器本地转换、不上传）：转码器是纯函数，理论上能在浏览器里跑，没验证。
- 发版：打 tag、npm 发布由所有者确认，npm 登录和验证码只有所有者能做。

## 6. 工具和约定（怎么干活，别踩坑）

**规则（违反过、教训很深）**：
- **发版前必须用本机全部课件做逐页 A/B 比对**，不能只看"转码成功"；新版 vs 上一个发布版，变差的页逐类查清（0.3.0 因为表格居中漏测被撤回）。工具：`tools/compare/sweep_ab.py`（比对）→ `tools/compare/release_gate.py`（收尾：重测卡住的、对比、出报告、下结论）→ `tools/compare/corpus_report.py`（测试报告）。用法在 CLAUDE.md。
- **发版前审视文档**：`python tools/dev/doc_check.py --since <上一版 tag>`，再对照改过的代码重看设计文档、README、SPEC、CHANGELOG，中英文一致，面向使用者的文档不堆术语（术语第一次出现解释，通用概念给链接）。写进 [docs/release.md](../release.md)。
- **样本安全（最重要）**：`samples/` 里是客户课件。样本及其衍生物（文件名、哈希以外的标识、文字、截图、参考图）**绝不能**进仓库、提交信息、文档、`testcases/`，也不能发到网络服务。报告里样本只用内容哈希，文档里连哈希都不要写。要固定成测试用例，只能用 PowerPoint 重新合成中性内容。
- 不刷分：不为了让分数好看改比对工具、阈值、参考图；改了必须在提交信息和 docs/todo 里写明原因。
- **规则的先实测**：PowerPoint 怎么排，先用 COM 探针在本机 PowerPoint 里量，规则写进 SPEC 第 7 节，再改代码。
- 提交信息中文，前缀 `fix:` `feat:` `docs:` `test:` `refactor:`，不含样本信息；每个能独立验证的小步一提交并推送。
- 禁止强制推送；不要从 dev 以外乱拉分支，新分支用 `git switch -c <新分支> origin/dev` 或 `git push -u origin <分支>`，推送前 `git rev-parse --abbrev-ref @{upstream}` 看上游。

**机器和进程**：
- 同一时间只能一个程序用 PowerPoint（COM）。多个 agent 并行时，凡是会启动 PowerPoint 的命令都要排队，别各开一个。结束后只关自己开的 PowerPoint / Excel 进程，别杀用户开的。
- 全量比对很耗 CPU：`sweep_ab.py` 默认空闲优先级、`--workers N`；机器被别的任务占满、比对几乎不动时加 `--priority below`。所有者在同一台电脑上办公，别把 CPU 占满。
- D 盘空间有限：比对每转完一份就删临时产物；下载新课件前先看剩余空间，少于 50GB 就停。
- **删 git worktree 前先扫目录链接**（junction）：有链接先 `cmd /c rmdir <链接>`，否则 `git worktree remove --force` 可能顺着链接删掉主仓库的样本和参考图。复制依赖，别用链接。

**踩过的坑**：
- Windows 上写 Python 脚本时，shell 的 heredoc 会吃掉反斜杠（`\n` 变成真换行）：用编辑工具、或者用 `chr(92)`。
- npm 登录过期时 `npm publish` 报 **404**（不是包不存在）；公司 npm 镜像（所有者的机器上）装包要加 `--registry https://registry.npmjs.org/`，这是所有者自己电脑的情况，不要写进用户文档。
- 本机装的 Noto Sans SC 是**可变字体**（默认实例是 Thin），已经处理（`font/fvar.ts`、`font/instance.ts`）；再遇到"文字画成细线"先查这个。

## 7. 重要文件地图

| 要看什么 | 在哪 |
|---|---|
| 需求和已确认的决定（D1…）、实测的 PowerPoint 规则（第 7 节） | [SPEC.md](../../SPEC.md) |
| 架构、扩展点、分层规则 | [docs/architecture.md](../architecture.md)；转码器详细设计 [transcoding.md](../zh/transcoding.md)；播放器 [player.md](../zh/player.md)；产物格式 [output-format.md](../zh/output-format.md) |
| 怎么测、怎么比 | [docs/zh/fidelity.md](../zh/fidelity.md)；相似度（SSIM）怎么算见其中的 [#ssim](../zh/fidelity.md#ssim) |
| 发版流程 | [docs/release.md](../release.md) |
| 调研记录 | [docs/zh/research/](../zh/research/README.md) |
| 更新日志、测试报告 | [CHANGELOG.md](../../CHANGELOG.md)、[test-report.md](../zh/test-report.md) |
| 本文件之前的开发记录（倒序） | [docs/todo/dev.md](dev.md) |
| 比对、验收、文档检查脚本 | `tools/compare/`（`run.py` `sweep_ab.py` `release_gate.py` `corpus_report.py`）、`tools/dev/`（`land.py` `doc_check.py`）、`tools/fonts/glyph_audit.py` |

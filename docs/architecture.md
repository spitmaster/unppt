# unppt 技术架构

> 这份文档和代码一起迭代：改了模块结构、加了扩展点，就在同一个提交里更新这里的图。
> 图用 Mermaid 写，GitHub 上直接显示成图，改图就是改文本。

## 1. 总体

```mermaid
flowchart LR
  pptx[(.pptx 文件)] --> T
  fonts[(字体目录<br/>可选)] -.-> T
  subgraph T["转码器 unppt（纯函数，零依赖，可部署成云函数）"]
    direction TB
    read[读取<br/>zip / XML / OPC 包] --> model[文档模型<br/>主题 / 母版 / 版式继承]
    model --> render[逐页渲染成 SVG]
    model --> anim[动画 / 切换编译]
    render --> out[流式输出]
    anim --> out
  end
  out --> html[(自带播放器的 HTML)]
  out --> json[(deck.json + media/)]
  html --> P
  json --> P
  subgraph P["播放器 @unppt/player（零依赖，约 20KB）"]
    direction TB
    nav[翻页 / 步骤] --> engine[动画引擎]
    nav --> trans[页面切换]
    bridge[JS bridge]
  end
  host[宿主页面 / 原生 App] <-->|"postMessage / UnpptNative / window.unppt"| bridge
```

- **转码器和播放器只通过 `@unppt/format` 里定义的数据格式交流**（`Deck`、`DeckSlide`、`AnimAction`、`SlideTransition`、bridge 协议）。两边可以独立部署、独立升级。
- 转码器不依赖任何环境：输入是字节（或按需读取的数据源），输出是字节流；字体只是可选输入。

## 2. 转码器内部（现状）

```mermaid
flowchart TB
  subgraph io[读取层]
    source[source.ts<br/>按需读取的数据源] --> zip[zip.ts<br/>ZIP / ZIP64]
    zip --> pkg[package.ts<br/>OPC 包、关系]
    xml[xml.ts<br/>XML 解析]
  end
  subgraph model[文档模型]
    m[model.ts<br/>演示文稿 / 主题 / 母版 / 版式 / 占位符]
    color[color.ts<br/>颜色和颜色变换]
  end
  subgraph render[渲染]
    r[render.ts<br/>SlideRenderer：形状 / 图片 / 组合 / graphicFrame 分派]
    geo[geometry.ts + presets<br/>187 种预设形状公式]
    fill[fill.ts<br/>填充 / 线条 / 图片调整 / 阴影发光等效果]
    text[text.ts<br/>字体替代 / 测量 / 断行 / SVG 文字]
    table[table.ts]
    chart[chart.ts<br/>全部图表类型]
    links[links.ts]
  end
  subgraph media[资源]
    store[media.ts<br/>图片 / 音视频 / EMF、WMF 转 SVG]
    emf[emf.ts]
    wmf[wmf.ts]
    font[font.ts + kern.ts<br/>TrueType 解析、字距]
    subset[subset.ts<br/>字体子集 WOFF]
  end
  anim[anim.ts<br/>动画时间线 / 效果 / 切换]
  index[index.ts<br/>convert：逐页、流式输出 HTML 或数据]
  index --> r & anim & store & subset
  r --> geo & fill & text & table & chart & links & store
  table -.循环依赖.-> r
  store --> emf & wmf
  text --> font
```

### 现状的问题（2026-10-13 评估）

| 位置 | 问题 | 违反的原则 |
|---|---|---|
| `player.ts`（约 800 行） | 一个类包了翻页、动画引擎、切换、界面、键盘触屏、bridge、自动启动 | 单一职责 |
| `player.ts` 切换、`anim` 效果 | `switch` 分支，加一种效果要改核心代码 | 开闭 |
| `chart.ts`（约 740 行） | 一个巨型函数，图表类型靠 if/else | 单一职责、开闭 |
| `text.ts`（约 690 行） | 字体替代、测量、断行、SVG 输出混在一起 | 单一职责 |
| `render.ts` | 表格 / 图表 / SmartArt / OLE 分派写死；和 `table.ts` 循环依赖 | 开闭、依赖倒置 |
| `fill.ts` | 填充、线条、图片调整、形状效果混在一起 | 单一职责 |
| `media.ts` | 图片格式写死 `if (ext === 'emf' / 'wmf')` | 开闭 |

## 3. 目标结构（重构进行中）

原则：**加一个新功能 = 加一个文件 + 在注册表里加一行**，不改别人的文件。每个扩展点有一个接口。

```mermaid
flowchart TB
  subgraph ext[扩展点（接口 + 注册表）]
    dec[ImageDecoder<br/>emf / wmf / …]
    eff[ShapeEffect<br/>外阴影 / 发光 / 柔化边缘 / 内阴影 / …]
    frame[FrameHandler<br/>表格 / 图表 / SmartArt / OLE]
    ct[ChartType<br/>柱形 / 折线面积 / 饼 / 散点 / 雷达 / …]
    tr[Transition（播放器）<br/>淡入 / 推入 / 擦除 / …]
    ae[AnimEffect（播放器）<br/>飞入 / 擦除 / 缩放 / …]
  end
```

| 扩展点 | 接口 | 怎么加一个新的 |
|---|---|---|
| 图片格式 | `ImageDecoder` | 待实现 |
| 形状效果 | `ShapeEffect` | 待实现 |
| graphicFrame 内容 | `FrameHandler` | 待实现 |
| 图表类型 | `ChartType` | 待实现 |
| 页面切换 | `Transition` | 待实现 |
| 进入/退出动画效果 | `AnimEffect` | 待实现 |

重构的安全网：`node scripts/golden.mjs save` 记录全部测试用例的输出，重构后 `node scripts/golden.mjs check` 必须**逐字节一致**；行为改动（修 bug、加功能）不走这条路，走比对和逐页回归。

## 4. 开发闭环

```mermaid
flowchart LR
  samples[(samples/ 样本<br/>不出本机)] --> export[PowerPoint 导出参考图<br/>tools/powerpoint]
  cases[(testcases/ 合成用例)] --> export
  export --> compare[截图比对 / 形状诊断<br/>tools/compare]
  compare --> clusters[失败原因排行<br/>只有数字]
  clusters --> make[合成中性用例<br/>tools/make-case]
  make --> fix[改 packages/ 代码]
  fix --> gate{验收<br/>无回归 / 测试通过}
  gate --> compare
```

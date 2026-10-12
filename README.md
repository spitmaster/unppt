# unppt

把 PowerPoint（.pptx）转成可以嵌入任意网页播放的静态产物。

- **转码器**：纯函数，零依赖，pptx 字节进、产物文件出，可以直接放进云函数；
- **播放器**：浏览器 JS，可以用 iframe 嵌入，支持外部控制翻页和播放动画；
- **目标**：效果和 Microsoft PowerPoint 一致，用 PowerPoint 的输出做自动化比对评测。

> 项目处于早期开发阶段。需求和设计见 [SPEC.md](SPEC.md)。

## 许可证

Apache-2.0

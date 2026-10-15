# 第三方组件

转码器发布包里包含以下第三方组件（原样使用，没有修改）：

| 组件 | 版本 | 许可证 | 源码 | 用途 |
|---|---|---|---|---|
| resvg-js（@resvg/resvg-wasm，resvg 的 WebAssembly 版） | 2.6.2 | MPL-2.0 | https://github.com/yisibl/resvg-js | 把页面画成整页图和缩略图（`dist/resvg.wasm` 和打进 `dist/index.js`、`dist/cli.js` 的 JS 部分） |
| saxes | 6.0.0 | ISC | https://github.com/lddubeau/saxes | XML 解析（打进 `dist/index.js`、`dist/cli.js`） |
| xmlchars（saxes 的依赖） | 2.2.0 | MIT | https://github.com/lddubeau/xmlchars | XML 字符判定（同上） |

MPL-2.0 全文：https://www.mozilla.org/MPL/2.0/

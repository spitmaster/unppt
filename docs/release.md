# 发布到 npm

发布两个包（0.3.0 起）：

- 转码器 `@unppt/unppt`（`packages/transcoder`；不带作用域的 `unppt` 被 npm 判为和 unpdf、unpipe、nopt 太像而拒绝，`@unppt` 是发布账号的用户名作用域）：播放器已经内嵌在它的产物里，`@unppt/format`、`@unppt/player` 暂不发布；
- 默认字体包 `@unppt/fonts`（`packages/fonts`）：开源字体文件 + 字体度量包，转码器依赖它（`^0.3.1`）。**字体包要先发**，否则装转码器时找不到依赖。字体包的版本号单独管理：字体文件、对照表 `map.json`、度量包有变化时才加版本号（同时改转码器 `package.json` 里依赖它的版本范围），没变就不发。

字体文件不在 git 里（约 87MB）：`node scripts/fetch-fonts.mjs` 按 `packages/fonts/fonts.json` 下载并校验 SHA-256，放进 `packages/fonts/files/`；`npm pack` / `npm publish` 前 `prepack` 会检查文件齐全，缺文件就失败（避免发出一个没有字体的包）。

## 注意：发布源

本机全局的 `~/.npmrc` 可能指向公司私有源。`packages/transcoder` 目录不会继承仓库根目录的 `.npmrc`，所以 `package.json` 里用 `publishConfig.registry` 把发布源固定成 npm 公共库（`https://registry.npmjs.org/`），登录、查询时也要显式写 `--registry`。

## 第一次：登录

```bash
npm login --registry https://registry.npmjs.org/
npm whoami --registry https://registry.npmjs.org/
```

npm 要求发布包的账号**必须开启双重验证（2FA）**，否则发布报 403：到 npmjs.com 右上角头像 → Account → Two-Factor Authentication 开启（用手机验证器 App 扫码）。之后发布时带上验证器里的 6 位数字：`npm publish --otp=123456`。

## 字体包第一次发布（只需要手动做一次）

npm 的"可信发布"只能给已经存在的包绑定，所以 `@unppt/fonts` 第一次要在本机手动发（先 `git pull` 到要发布的那次提交）：

```bash
node scripts/fetch-fonts.mjs
cd packages/fonts
npm pack --dry-run            # files/ 下应该是 fonts.json 列的全部字体文件（现在 30 个），还有 metrics/、LICENSES/、map.json、fonts.json、index.js
npm publish --access public --otp=<验证器里的 6 位数字>
npm view @unppt/fonts@<版本> dist.fileCount --registry https://registry.npmjs.org/   # 能查到才算发好了
```

发完到 npmjs.com → @unppt/fonts → Settings → Trusted Publisher 绑定 GitHub Actions：`spitmaster/unppt` 的 `release.yml`（和 @unppt/unppt 一样，环境名留空）。
之后推转码器的版本标签，工作流会跳过已经发过的字体包、自动发转码器。

字体包的内容（字体文件、`compat/` 里的兼容字体、`map.json`、`metrics/`）有任何变化都要加版本号，转码器 `package.json` 里依赖它的范围跟着改：
同一个版本号 npm 只收一次，内容不同却用同一个版本号，npm 上的和 GitHub Release 里的就对不上了。
（0.3.0 发布前的审查发现兼容字体缺名字、度量包缺空格的字距，字体包改成 0.3.1 发布，转码器依赖 `^0.3.1`。）

## 每次发布

1. 改版本号：`packages/transcoder/package.json` 的 `version`（同时改仓库根目录 `package.json` 和 `packages/format/src/index.ts` 里的 `UNPPT_VERSION`，三处保持一致）；
2. 构建和测试：`npm run build`、`npm test`；
3. 看包里有什么：在 `packages/transcoder` 里执行 `npm pack --dry-run`，应该只有 `dist/`（`cli.js`、`index.js`、`node.js`、`raster-worker.js`、`resvg.wasm`）、`README.md`、`LICENSE`、`THIRD-PARTY-NOTICES.md`、`package.json`；
4. 发布：在 `packages/transcoder` 里执行 `npm publish --otp=<验证器里的 6 位数字>`；输出里不能有 `warn publish ... auto-corrected`（npm 会悄悄删掉它认为写错的字段，例如 `bin` 路径写成 `./dist/cli.js` 就会被删，命令行装好后用不了）；
5. 打标签：`git tag v<版本>`，再 `git push origin v<版本>`。

命令在 Windows 的 PowerShell 里同样能用（PowerShell 5.1 不支持 `&&`，上面的命令都是一条一条执行的）。

同一个版本号只能发布一次（撤回后也不能重用），发错了就把版本号加一重新发。

## GitHub Release 和安装包（自动）

推送 `v*` 标签后，GitHub Actions（`.github/workflows/release.yml`）自动构建、测试、`npm pack`，创建同名 Release，附上三个安装包：
`unppt-unppt-<版本>.tgz`、固定名字的 `unppt.tgz` 和字体包 `unppt-fonts.tgz`（所以 `https://github.com/spitmaster/unppt/releases/latest/download/unppt.tgz` 总是最新版）。
用户下载 `unppt-fonts.tgz` 和 `unppt.tgz` 后 `npm install -g ./unppt-fonts.tgz ./unppt.tgz` 一起安装，不经过 npm 官方源
（转码器依赖字体包，只装 `unppt.tgz` 会去 npm 源下载字体包；npm 12 起默认不允许直接从网址或 git 安装，所以文档里写的是先下载再安装）。

已经推送过的标签（例如加这个工作流之前的 v0.2.0）：GitHub 仓库 → Actions → release → Run workflow，填标签名。
标签和 `packages/transcoder/package.json` 的版本号不一致时工作流会失败。

## 自动发布到 npm（可信发布）

npm 网站上 @unppt/unppt → Settings → Trusted Publisher 绑定了 GitHub Actions：`spitmaster/unppt` 的 `release.yml`（环境名留空）。
之后推送 `v*` 标签，工作流在建好 GitHub Release 后自动 `npm publish --provenance`，不需要本机登录和验证码；
npm 上已经有这个版本时跳过。npm 收到新版本后仍会先自动审查（Validating），通过后 latest 才切过去。

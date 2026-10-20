# 发布到 npm

只发布转码器一个包 `@unppt/unppt`（`packages/transcoder`；不带作用域的 `unppt` 被 npm 判为和 unpdf、unpipe、nopt 太像而拒绝，`@unppt` 是发布账号的用户名作用域）：播放器已经内嵌在它的产物里，`@unppt/format`、`@unppt/player` 暂不发布。

## 注意：发布源

本机全局的 `~/.npmrc` 可能指向公司私有源。`packages/transcoder` 目录不会继承仓库根目录的 `.npmrc`，所以 `package.json` 里用 `publishConfig.registry` 把发布源固定成 npm 公共库（`https://registry.npmjs.org/`），登录、查询时也要显式写 `--registry`。

## 第一次：登录

```bash
npm login --registry https://registry.npmjs.org/
npm whoami --registry https://registry.npmjs.org/
```

npm 要求发布包的账号**必须开启双重验证（2FA）**，否则发布报 403：到 npmjs.com 右上角头像 → Account → Two-Factor Authentication 开启（用手机验证器 App 扫码）。之后发布时带上验证器里的 6 位数字：`npm publish --otp=123456`。

## 每次发布

1. 改版本号：`packages/transcoder/package.json` 的 `version`（同时改仓库根目录 `package.json` 和 `packages/format/src/index.ts` 里的 `UNPPT_VERSION`，三处保持一致）；
2. 构建和测试：`npm run build`、`npm test`；
3. 看包里有什么：在 `packages/transcoder` 里执行 `npm pack --dry-run`，应该只有 `dist/`（`cli.js`、`index.js`、`node.js`、`raster-worker.js`、`resvg.wasm`）、`README.md`、`LICENSE`、`THIRD-PARTY-NOTICES.md`、`package.json`；
4. 发布：在 `packages/transcoder` 里执行 `npm publish --otp=<验证器里的 6 位数字>`；输出里不能有 `warn publish ... auto-corrected`（npm 会悄悄删掉它认为写错的字段，例如 `bin` 路径写成 `./dist/cli.js` 就会被删，命令行装好后用不了）；
5. 打标签：`git tag v<版本>`，再 `git push origin v<版本>`。

命令在 Windows 的 PowerShell 里同样能用（PowerShell 5.1 不支持 `&&`，上面的命令都是一条一条执行的）。

同一个版本号只能发布一次（撤回后也不能重用），发错了就把版本号加一重新发。

## GitHub Release 和安装包（自动）

推送 `v*` 标签后，GitHub Actions（`.github/workflows/release.yml`）自动构建、测试、`npm pack`，创建同名 Release，附上两个安装包：
`unppt-unppt-<版本>.tgz` 和固定名字的 `unppt.tgz`（所以 `https://github.com/spitmaster/unppt/releases/latest/download/unppt.tgz` 总是最新版）。
用户下载后 `npm install -g ./unppt.tgz` 即可安装，不经过 npm 官方源（npm 12 起默认不允许直接从网址或 git 安装，所以文档里写的是先下载再安装）。

已经推送过的标签（例如加这个工作流之前的 v0.2.0）：GitHub 仓库 → Actions → release → Run workflow，填标签名。
标签和 `packages/transcoder/package.json` 的版本号不一致时工作流会失败。

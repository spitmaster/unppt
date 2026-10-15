# 发布到 npm

只发布转码器一个包 `unppt`（`packages/transcoder`）：播放器已经内嵌在它的产物里，`@unppt/format`、`@unppt/player` 暂不发布。

## 注意：发布源

本机全局的 `~/.npmrc` 可能指向公司私有源。`packages/transcoder` 目录不会继承仓库根目录的 `.npmrc`，所以 `package.json` 里用 `publishConfig.registry` 把发布源固定成 npm 公共库（`https://registry.npmjs.org/`），登录、查询时也要显式写 `--registry`。

## 第一次：登录

```bash
npm login --registry https://registry.npmjs.org/
npm whoami --registry https://registry.npmjs.org/
```

账号开了双重验证（2FA）时，发布会再要一次验证码。

## 每次发布

1. 改版本号：`packages/transcoder/package.json` 的 `version`（同时改仓库根目录 `package.json` 和 `packages/format/src/index.ts` 里的 `UNPPT_VERSION`，三处保持一致）；
2. 构建和测试：`npm run build`、`npm test`；
3. 看包里有什么：在 `packages/transcoder` 里执行 `npm pack --dry-run`，应该只有 `dist/`（`cli.js`、`index.js`、`resvg.wasm`）、`README.md`、`LICENSE`、`THIRD-PARTY-NOTICES.md`、`package.json`；
4. 发布：在 `packages/transcoder` 里执行 `npm publish`；
5. 打标签：`git tag v<版本>`，再 `git push origin v<版本>`。

命令在 Windows 的 PowerShell 里同样能用（PowerShell 5.1 不支持 `&&`，上面的命令都是一条一条执行的）。

同一个版本号只能发布一次（撤回后也不能重用），发错了就把版本号加一重新发。

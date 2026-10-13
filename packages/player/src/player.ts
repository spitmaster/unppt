/**
 * unppt 播放器入口：零依赖，打包成一个文件（全局名 UnpptPlayer）。
 *
 * 两种用法：
 * 1. 转码出来的 HTML 里自动启动；
 * 2. 单独部署：UnpptPlayer.mount(元素, deck对象, 选项)。
 * 外部控制（JS bridge）见 SPEC F2 和 bridge.ts。模块结构见 docs/architecture.md。
 */
import { autoBoot } from './boot';

export { Player, type MountOptions } from './core/player';
export { installBridge, type UnpptApi } from './bridge';
export { mount } from './boot';

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoBoot);
  else autoBoot();
}

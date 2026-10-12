/**
 * unppt 演示数据格式（deck.json），转码器和播放器之间唯一的约定。
 * 格式有变化时增加 DECK_FORMAT_VERSION，播放器遇到不认识的版本要明确报错。
 */

export const DECK_FORMAT = 'unppt-deck';
export const DECK_FORMAT_VERSION = 1;
export const UNPPT_VERSION = '0.0.1';

export interface Deck {
  format: typeof DECK_FORMAT;
  version: number;
  generator: string;
  /** 幻灯片宽高，单位像素（96dpi） */
  width: number;
  height: number;
  slides: DeckSlide[];
  fonts: DeckFont[];
  report: DeckReport;
}

export interface DeckSlide {
  /** 这一页的静态内容。可动画的元素带 data-uid 属性 */
  svg: string;
  /** 每次点击执行的动作；steps.length 就是这一页需要点击的次数 */
  steps: AnimAction[][];
  /** 进入页面时（第 0 步之前）就要执行的自动动作，例如"与上一动画同时"开头的效果 */
  auto: AnimAction[];
  /** 第 0 步时隐藏的元素（有进入动画的） */
  hidden: string[];
  /** 页面切换效果 */
  transition?: SlideTransition;
}

export type AnimEffect =
  | 'appear' | 'fade' | 'fly' | 'wipe' | 'zoom' | 'split' | 'float' | 'wheel' | 'random'
  | 'emphasis' | 'path';

export interface AnimAction {
  uid: string;
  effect: AnimEffect;
  /** in = 进入，out = 退出，emph = 强调（不改变最终可见性） */
  dir: 'in' | 'out' | 'emph';
  /** 毫秒 */
  dur: number;
  delay: number;
  /** 飞入等效果的方向：l/r/t/b */
  from?: 'l' | 'r' | 't' | 'b';
}

export interface SlideTransition {
  type: 'none' | 'fade' | 'push' | 'wipe' | 'cover';
  dur: number;
}

export interface DeckFont {
  /** 嵌入后使用的字体名（唯一别名，例如 unppt-f0） */
  family: string;
  /** 原来的字体名 */
  source: string;
  weight: 'normal' | 'bold';
  style: 'normal' | 'italic';
  format: 'woff';
  /** 只输出数据（deck.json）时：字体文件的相对路径。HTML 模式下字体数据在 script.unppt-font 里 */
  url?: string;
}

export interface DeckReport {
  /** 文档里用到但没有提供字体文件的字体名 */
  missingFonts: string[];
  warnings: string[];
}

/** 播放器状态 */
export interface PlayerState {
  slide: number;
  step: number;
  slideCount: number;
  stepCount: number;
}

/** bridge 消息：宿主发给播放器 */
export interface BridgeCommand {
  unppt: 1;
  id?: number | string;
  cmd: 'next' | 'prev' | 'goto' | 'getState';
  args?: { slide?: number; step?: number };
}

/** bridge 消息：播放器发给宿主（指令的返回值） */
export interface BridgeReply {
  unppt: 1;
  re: number | string;
  ok: boolean;
  result?: PlayerState;
  error?: string;
}

/** bridge 消息：播放器发给宿主（事件） */
export interface BridgeEvent {
  unppt: 1;
  event: 'ready' | 'change' | 'end';
  data: PlayerState;
}

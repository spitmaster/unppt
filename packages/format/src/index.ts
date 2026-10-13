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
  /** 每个输出页对应的 pptx 内部部件路径（解析 data-link="slide:..." 用） */
  slideParts?: string[];
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
  /** 触发器动画：点击某个元素时依次播放的动作（每点一次播一组），不影响普通的点击顺序 */
  triggers?: { uid: string; steps: AnimAction[][] }[];
  /** 页面切换效果 */
  transition?: SlideTransition;
}

export type AnimEffect =
  | 'appear' | 'fade' | 'fly' | 'wipe' | 'zoom' | 'split' | 'float' | 'wheel' | 'random'
  | 'emphasis' | 'path' | 'media';

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
  /** 强调、路径动画结束后保持的状态（累加到元素当前状态上） */
  to?: AnimTarget;
  /** 媒体命令：播放（从 start 秒开始）、暂停、停止 */
  media?: 'play' | 'pause' | 'stop' | 'toggle';
  start?: number;
  /** 文字逐字（letter）/ 逐词（word）播放：每个字（词）各自播 dur，相邻两个间隔 gap 毫秒 */
  iterate?: { by: 'letter' | 'word'; gap: number };
}

export interface AnimTarget {
  /** 缩放倍数（相对当前） */
  scale?: [number, number];
  /** 旋转角度（度，相对当前） */
  rotate?: number;
  /** 移动距离（像素，相对当前） */
  move?: [number, number];
  /** 路径动画经过的点（像素，相对当前位置），最后一个点就是 move */
  path?: [number, number][];
  /** 过程不是从头到尾直线变化的强调动画（脉冲、跷跷板等）：按时间采样的缩放和旋转（相对当前状态） */
  keys?: { o: number; s: [number, number]; r: number }[];
  /** 新的填充颜色 */
  fill?: string;
  /** 新的文字颜色 */
  color?: string;
  /** 新的透明度 0~1 */
  opacity?: number;
}

export interface SlideTransition {
  /** push 推入、cover 覆盖、pull 揭开、wipe 擦除、split 分割、circle 圆形；其它切换都按 fade 淡入 */
  type: 'none' | 'fade' | 'push' | 'wipe' | 'cover' | 'pull' | 'split' | 'circle';
  dur: number;
  /** 运动方向（和 PowerPoint 一致）：l 向左（新页从右边进来）、r、u、d */
  dir?: 'l' | 'r' | 'u' | 'd';
  /** 分割：横向/纵向，向外展开/向内合拢 */
  orient?: 'horz' | 'vert';
  inOut?: 'in' | 'out';
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
  event: 'ready' | 'change' | 'end' | 'link';
  /** link 事件额外带 url：点击了外部链接 */
  data: PlayerState & { url?: string };
}

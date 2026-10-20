/**
 * unppt 演示数据格式（deck.json），转码器和播放器之间唯一的约定。
 * 格式有变化时增加 DECK_FORMAT_VERSION，播放器遇到不认识的版本要明确报错。
 */

export const DECK_FORMAT = 'unppt-deck';
export const DECK_FORMAT_VERSION = 1;
export const UNPPT_VERSION = '0.2.3';

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
  /** 放映设置：loop 循环放映（最后一页之后回到第一页）；useTimings 为 false 时不按计时自动换片 */
  show?: { loop?: boolean; useTimings?: boolean };
}

/**
 * 按需加载（paged / pages 形式）的目录，写在入口 HTML 的 <script id="unppt-index"> 里：
 * 除了页面以外的演示数据，加上每页数据文件和是否隐藏（顺序放映要跳过的页不用先下载就能知道）。
 * 页面数据文件是一段脚本：__unpptPage(页号, DeckSlide)；字体文件：__unpptFont(别名, base64 的 woff)，路径在 DeckFont.url
 */
export interface DeckIndex extends Omit<Deck, 'slides'> {
  pages: { file: string; skip?: true }[];
}
export const PAGE_CALLBACK = '__unpptPage';
export const FONT_CALLBACK = '__unpptFont';

export interface DeckSlide {
  /** 这一页的静态内容。可动画的元素带 data-uid 属性 */
  svg: string;
  /** 每次点击执行的动作；steps.length 就是这一页需要点击的次数 */
  steps: AnimAction[][];
  /** 进入页面时（第 0 步之前）就要执行的自动动作，例如"与上一动画同时"开头的效果 */
  auto: AnimAction[];
  /** 第 0 步时隐藏的元素（有进入动画的） */
  hidden: string[];
  /** 播放时全屏的视频（元素编号，PowerPoint 的"全屏播放"） */
  fullScreen?: string[];
  /** 触发器动画：点击某个元素时依次播放的动作（每点一次播一组），不影响普通的点击顺序 */
  triggers?: { uid: string; steps: AnimAction[][] }[];
  /** 页面切换效果 */
  transition?: SlideTransition;
  /** 隐藏的幻灯片：顺序放映时跳过，但可以通过超链接、动作按钮或 goto 跳过去 */
  skip?: boolean;
  /**
   * 换片方式：after 是自动换片时间（毫秒，从进入这页算起；和 PowerPoint 一样，按计时放映时这一页的点击步骤自动依次播放，
   * 到时间且动画都播完才翻页）；click 为 false 时单击画面不换片（键盘和接口照常）
   */
  advance?: { after?: number; click?: false };
}

export type AnimEffect =
  | 'appear' | 'fade' | 'fly' | 'wipe' | 'zoom' | 'split' | 'float' | 'wheel' | 'random'
  | 'shape' | 'blinds' | 'growTurn' | 'swivel' | 'bounce'
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
  /**
   * 效果的变体（播放器不认识时按默认画法）：
   * shape：circle|box|diamond|plus 加 -in|-out；split：vert-in|vert-out|horz-in|horz-out；
   * wheel：轮辐数；blinds：horz|vert，可加 -条数
   */
  variant?: string;
  /** 强调、路径动画结束后保持的状态（累加到元素当前状态上） */
  to?: AnimTarget;
  /** 媒体命令：播放（从 start 秒开始）、暂停、停止 */
  media?: 'play' | 'pause' | 'stop' | 'toggle';
  start?: number;
  /** 媒体连续播放的页数（含本页，"跨幻灯片播放"），大于 1 时翻页不停 */
  across?: number;
  /** 媒体循环播放直到停止 */
  loop?: boolean;
  /** 文字逐字（letter）/ 逐词（word）播放：每个字（词）各自播 dur，相邻两个间隔 gap 毫秒 */
  iterate?: { by: 'letter' | 'word'; gap: number };
  /** 整个效果重复播放的次数（"重复 3 次"是 3）；-1 表示一直重复到下一次点击 */
  repeat?: number;
  /** 播完再倒着播回去（自动翻转）：结束时回到效果开始前的样子 */
  autoRev?: boolean;
  /**
   * 进入/退出效果在 PowerPoint 里的具体行为（有它时播放器按行为播放，不看 effect/from/variant）。
   * 时间都在这个效果里算（毫秒）；accel/decel 是整个效果的加速、减速比例
   */
  behaviors?: AnimBehavior[];
  accel?: number;
  decel?: number;
  /** 动画附带的声音（PowerPoint 的"声音"效果选项）：动作开始时播放；新的声音会停掉正在播的声音 */
  sound?: Sound;
}

export interface TextStyleChange {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/** 一段声音：src 是媒体文件路径；loop 时一直循环到下一个声音 */
export interface Sound {
  src: string;
  loop?: true;
}

/**
 * 一个动画行为（PowerPoint 的 p:anim / p:animScale / p:animRot / p:animEffect）：在 [delay, delay+dur] 里按关键帧改变一个属性。
 * 属性：x、y 是元素中心的位置，w、h 是宽高（都是幻灯片宽高的比例）；sx、sy 是再乘上的缩放倍数；
 * r 是在原角度上加的旋转（度）；o 是不透明度；
 * reveal 是显现滤镜 filter：进入时按滤镜露出，退出（out）时被隐去的部分按同一个滤镜长大
 */
export interface AnimBehavior {
  prop: 'x' | 'y' | 'w' | 'h' | 'sx' | 'sy' | 'r' | 'o' | 'reveal';
  delay: number;
  dur: number;
  /**
   * 关键帧 [时间 0~1, 值, 公式?]。值是数字或 PowerPoint 公式（#ppt_x、#ppt_y、#ppt_w、#ppt_h 是元素原来的位置和大小，
   * 如 "1+#ppt_h/2"）；有公式时，这一段插值出来的数代入公式里的 $
   */
  keys?: [number, number | string, string?][];
  /** reveal 的滤镜，PowerPoint 的写法：wipe(down)、barn(inVertical)、circle(in)、wheel(4)、blinds(horizontal)…… */
  filter?: string;
  out?: boolean;
  /** 时间变换：加速、减速比例；tmFilter 是 [时间, 进度] 折线；往返；重复次数 */
  accel?: number;
  decel?: number;
  tmFilter?: [number, number][];
  autoRev?: boolean;
  repeat?: number;
  /** 离散变化（到时间直接跳到下一个关键帧的值） */
  discrete?: boolean;
}

export interface AnimTarget {
  /** 缩放倍数（相对当前） */
  scale?: [number, number];
  /** 旋转角度（度，相对当前） */
  rotate?: number;
  /** 移动距离（像素，相对当前） */
  move?: [number, number];
  /** 路径动画经过的点（像素，相对当前位置），最后一个点就是 move；沿路径按长度匀速走 */
  path?: [number, number][];
  /**
   * 过程不是从头到尾匀速变化的强调动画（脉冲、跷跷板、带加减速的旋转等）：按时间采样的缩放、旋转（相对当前状态），
   * a 是此刻的不透明度倍数（闪光灯、透明这类过程中变化、结束恢复的效果）
   */
  keys?: { o: number; s: [number, number]; r: number; a?: number }[];
  /** 移动、路径、缩放旋转过渡的加速、减速比例（PowerPoint 的"平滑开始/平滑结束"） */
  accel?: number;
  decel?: number;
  /** 新的填充颜色 */
  fill?: string;
  /** 新的文字颜色 */
  color?: string;
  /** 新的透明度 0~1 */
  opacity?: number;
  /** "动画播放后变暗"的颜色：文字改成这个颜色，没有文字时改形状的填充 */
  dim?: string;
  /** 缩放、旋转的原点（相对元素外框的比例，默认中心）；更改字号按左上角放大（PowerPoint 是重新排版，这里近似） */
  origin?: [number, number];
  /** 一直保留的文字样式：加粗、倾斜、下划线（true 打开，false 关掉） */
  font?: TextStyleChange;
  /** 只在效果过程中出现、之后恢复的文字样式（加粗闪烁、样式强调）：from、to 是在效果时长里的位置（0~1） */
  flash?: (TextStyleChange & { from: number; to: number; color?: string })[];
}

export interface SlideTransition {
  /**
   * fade 淡入（thruBlk 时先变黑再从黑色淡入）、cut 穿过黑色切出（thruBlk）、flash 闪光、
   * push 推入、cover 覆盖、pull 揭开、wipe 擦除、split 分割、strips 条纹、
   * circle 圆形、diamond 菱形、plus 加号、zoom 盒状、wheel 轮子（spokes 条轮辐，ccw 逆时针）、wedge 扇形、newsflash 新闻快报、
   * blinds 百叶窗、checker 棋盘、comb 梳理、randomBar 随机线条、dissolve 溶解；
   * morph 平滑切换：前后两页里同名（data-name）的顶层对象从旧位置、旧大小变到新位置、新大小，其余内容淡入。
   * 播放器不认识的类型按 fade 播放；none 时没有切换效果，但仍可能带声音
   */
  type:
    | 'none' | 'fade' | 'cut' | 'flash' | 'push' | 'wipe' | 'cover' | 'pull' | 'split' | 'strips'
    | 'circle' | 'diamond' | 'plus' | 'zoom' | 'wheel' | 'wedge' | 'newsflash'
    | 'blinds' | 'checker' | 'comb' | 'randomBar' | 'dissolve' | 'morph';
  dur: number;
  /** 运动方向（和 PowerPoint 一致）：l 向左（新页从右边进来）、r、u、d；覆盖、揭开、条纹还有斜向 lu、ru、ld、rd */
  dir?: 'l' | 'r' | 'u' | 'd' | 'lu' | 'ru' | 'ld' | 'rd';
  /** 分割的分割线、百叶窗/棋盘/梳理/随机线条的条纹方向：horz 横向、vert 纵向 */
  orient?: 'horz' | 'vert';
  /** 分割、盒状：in 向内收拢，out 向外展开 */
  inOut?: 'in' | 'out';
  /** 淡入、切出：穿过黑色 */
  thruBlk?: true;
  /** 轮子：轮辐数（默认 4） */
  spokes?: number;
  /** 轮子：逆时针 */
  ccw?: true;
  /** 切换时播放的声音；stopSound 是"停止前一声音" */
  sound?: Sound;
  stopSound?: true;
}

export interface DeckFont {
  /** 嵌入后使用的字体名（唯一别名，例如 unppt-f0） */
  family: string;
  /** 原来的字体名 */
  source: string;
  weight: 'normal' | 'bold';
  style: 'normal' | 'italic';
  format: 'woff';
  /** 字体文件的相对路径：data 形式是 .woff，按需加载形式是调用 __unpptFont 的脚本；single 形式下字体数据在 script.unppt-font 里 */
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
  /** 黑屏 / 白屏的颜色（在显示幻灯片时没有这一项） */
  blank?: string;
  /** 这一页每个触发器已经播到第几组（点过的才有） */
  triggers?: Record<string, number>;
  /** 这一页播放过的音视频：所在形状的编号、是否在播、当前时间（秒） */
  media?: { uid: string; playing: boolean; time: number }[];
}

/** bridge 消息：宿主发给播放器 */
export interface BridgeCommand {
  unppt: 1;
  id?: number | string;
  /** sync：跟上演绎端的状态（正好下一步时播动画，否则直接跳），见 SPEC F2 */
  cmd: 'next' | 'prev' | 'goto' | 'sync' | 'getState';
  /** goto 用 slide、step；sync 可以带上整个状态（PlayerState 的各项） */
  args?: Partial<PlayerState>;
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

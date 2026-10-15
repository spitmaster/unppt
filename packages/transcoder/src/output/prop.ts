/**
 * prop.json（SPEC F1）：页数、画面宽高（磅）、缩略图宽高、每页的整页图 / 缩略图路径、演讲者备注、是否隐藏。
 * 沿用直播服务对接微演示的约定：index 从 1 开始，图片文件名是页号，路径相对 prop.json 所在目录。
 */
export interface PropSlide { note: string; hidden: boolean }

export interface PropInput {
  /** 幻灯片尺寸（磅） */
  width: number;
  height: number;
  thumbWidth: number;
  thumbHeight: number;
  slides: PropSlide[];
}

export function propJson(p: PropInput): string {
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return JSON.stringify({
    count: p.slides.length,
    picw: r2(p.width),
    pich: r2(p.height),
    thumw: p.thumbWidth,
    thumh: p.thumbHeight,
    slides: p.slides.map((s, i) => ({
      index: i + 1, thum: `thum/${i + 1}.jpg`, pic: `pic/${i + 1}.jpg`,
      ...(s.note ? { note: s.note } : {}), ...(s.hidden ? { hidden: 1 } : {}),
    })),
  }, null, 1);
}

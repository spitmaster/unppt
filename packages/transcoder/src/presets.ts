/**
 * 预设形状定义（按 ECMA-376 DrawingML 预设形状的公式语言书写）。
 * 未收录的预设形状会按矩形兜底，并在转码报告里列出名字，方便按出现频率补充。
 *
 * 语法：
 *   shape 名字
 *   av 调整值名 默认值
 *   gd 变量名 公式
 *   path [w=数字] [h=数字] [fill=none] [stroke=0]
 *   M x y | L x y | A wR hR 起始角 扫过角 | C x1 y1 x2 y2 x y | Q x1 y1 x y | Z
 */
import type { GeomDef, GeomPath } from './geometry';

const SRC = `
shape rect
path
M l t
L r t
L r b
L l b
Z

shape roundRect
av adj 16667
gd a pin 0 adj 50000
gd x1 */ ss a 100000
gd x2 +- r 0 x1
gd y2 +- b 0 x1
path
M l x1
A x1 x1 cd2 cd4
L x2 t
A x1 x1 3cd4 cd4
L r y2
A x1 x1 0 cd4
L x1 b
A x1 x1 cd4 cd4
Z

shape ellipse
path
M l vc
A wd2 hd2 cd2 cd4
A wd2 hd2 3cd4 cd4
A wd2 hd2 0 cd4
A wd2 hd2 cd4 cd4
Z

shape flowChartConnector
path
M l vc
A wd2 hd2 cd2 cd4
A wd2 hd2 3cd4 cd4
A wd2 hd2 0 cd4
A wd2 hd2 cd4 cd4
Z

shape triangle
av adj 50000
gd a pin 0 adj 100000
gd x2 */ w a 100000
path
M l b
L x2 t
L r b
Z

shape rtTriangle
path
M l b
L l t
L r b
Z

shape diamond
path
M l vc
L hc t
L r vc
L hc b
Z

shape parallelogram
av adj 25000
gd maxAdj */ 100000 w ss
gd a pin 0 adj maxAdj
gd x2 */ ss a 100000
gd x5 +- r 0 x2
path
M l b
L x2 t
L r t
L x5 b
Z

shape trapezoid
av adj 25000
gd maxAdj */ 50000 w ss
gd a pin 0 adj maxAdj
gd x2 */ ss a 100000
gd x3 +- r 0 x2
path
M l b
L x2 t
L x3 t
L r b
Z

shape pentagon
av hf 105146
av vf 110557
gd swd2 */ wd2 hf 100000
gd shd2 */ hd2 vf 100000
gd svc */ vc vf 100000
gd dx1 cos swd2 1080000
gd dx2 cos swd2 18360000
gd dy1 sin shd2 1080000
gd dy2 sin shd2 18360000
gd x1 +- hc 0 dx1
gd x2 +- hc 0 dx2
gd x3 +- hc dx2 0
gd x4 +- hc dx1 0
gd y1 +- svc 0 dy1
gd y2 +- svc 0 dy2
path
M x1 y1
L hc t
L x4 y1
L x3 y2
L x2 y2
Z

shape hexagon
av adj 25000
av vf 115470
gd maxAdj */ 50000 w ss
gd a pin 0 adj maxAdj
gd shd2 */ hd2 vf 100000
gd x1 */ ss a 100000
gd x2 +- r 0 x1
gd dy1 sin shd2 3600000
gd y1 +- vc 0 dy1
gd y2 +- vc dy1 0
path
M l vc
L x1 y1
L x2 y1
L r vc
L x2 y2
L x1 y2
Z

shape octagon
av adj 29289
gd a pin 0 adj 50000
gd x1 */ ss a 100000
gd x2 +- r 0 x1
gd y2 +- b 0 x1
path
M l x1
L x1 t
L x2 t
L r x1
L r y2
L x2 b
L x1 b
L l y2
Z

shape homePlate
av adj 50000
gd maxAdj */ 100000 w ss
gd a pin 0 adj maxAdj
gd dx1 */ ss a 100000
gd x1 +- r 0 dx1
path
M l t
L x1 t
L r vc
L x1 b
L l b
Z

shape chevron
av adj 50000
gd maxAdj */ 100000 w ss
gd a pin 0 adj maxAdj
gd x1 */ ss a 100000
gd x2 +- r 0 x1
path
M l t
L x2 t
L r vc
L x2 b
L l b
L x1 vc
Z

shape rightArrow
av adj1 50000
av adj2 50000
gd maxAdj2 */ 100000 w ss
gd a1 pin 0 adj1 100000
gd a2 pin 0 adj2 maxAdj2
gd dx1 */ ss a2 100000
gd x1 +- r 0 dx1
gd dy1 */ h a1 200000
gd y1 +- vc 0 dy1
gd y2 +- vc dy1 0
path
M l y1
L x1 y1
L x1 t
L r vc
L x1 b
L x1 y2
L l y2
Z

shape leftArrow
av adj1 50000
av adj2 50000
gd maxAdj2 */ 100000 w ss
gd a1 pin 0 adj1 100000
gd a2 pin 0 adj2 maxAdj2
gd dx2 */ ss a2 100000
gd x2 +- l dx2 0
gd dy1 */ h a1 200000
gd y1 +- vc 0 dy1
gd y2 +- vc dy1 0
path
M l vc
L x2 t
L x2 y1
L r y1
L r y2
L x2 y2
L x2 b
Z

shape upArrow
av adj1 50000
av adj2 50000
gd maxAdj2 */ 100000 h ss
gd a1 pin 0 adj1 100000
gd a2 pin 0 adj2 maxAdj2
gd dy2 */ ss a2 100000
gd y2 +- t dy2 0
gd dx1 */ w a1 200000
gd x1 +- hc 0 dx1
gd x2 +- hc dx1 0
path
M l y2
L hc t
L r y2
L x2 y2
L x2 b
L x1 b
L x1 y2
Z

shape downArrow
av adj1 50000
av adj2 50000
gd maxAdj2 */ 100000 h ss
gd a1 pin 0 adj1 100000
gd a2 pin 0 adj2 maxAdj2
gd dy1 */ ss a2 100000
gd y1 +- b 0 dy1
gd dx1 */ w a1 200000
gd x1 +- hc 0 dx1
gd x2 +- hc dx1 0
path
M l y1
L x1 y1
L x1 t
L x2 t
L x2 y1
L r y1
L hc b
Z

shape leftRightArrow
av adj1 50000
av adj2 50000
gd maxAdj2 */ 50000 w ss
gd a1 pin 0 adj1 100000
gd a2 pin 0 adj2 maxAdj2
gd x2 */ ss a2 100000
gd x3 +- r 0 x2
gd dy */ h a1 200000
gd y1 +- vc 0 dy
gd y2 +- vc dy 0
path
M l vc
L x2 t
L x2 y1
L x3 y1
L x3 t
L r vc
L x3 b
L x3 y2
L x2 y2
L x2 b
Z

shape star5
av adj 19098
av hf 105146
av vf 110557
gd a pin 0 adj 50000
gd swd2 */ wd2 hf 100000
gd shd2 */ hd2 vf 100000
gd svc */ vc vf 100000
gd dx1 cos swd2 1080000
gd dx2 cos swd2 18360000
gd dy1 sin shd2 1080000
gd dy2 sin shd2 18360000
gd x1 +- hc 0 dx1
gd x2 +- hc 0 dx2
gd x3 +- hc dx2 0
gd x4 +- hc dx1 0
gd y1 +- svc 0 dy1
gd y2 +- svc 0 dy2
gd iwd2 */ swd2 a 50000
gd ihd2 */ shd2 a 50000
gd sdx1 cos iwd2 20520000
gd sdx2 cos iwd2 3240000
gd sdy1 sin ihd2 3240000
gd sdy2 sin ihd2 20520000
gd sx1 +- hc 0 sdx1
gd sx2 +- hc 0 sdx2
gd sx3 +- hc sdx2 0
gd sx4 +- hc sdx1 0
gd sy1 +- svc 0 sdy1
gd sy2 +- svc 0 sdy2
gd sy3 +- svc ihd2 0
path
M x1 y1
L sx2 sy1
L hc t
L sx3 sy1
L x4 y1
L sx4 sy2
L x3 y2
L hc sy3
L x2 y2
L sx1 sy2
Z

shape plus
av adj 25000
gd a pin 0 adj 50000
gd x1 */ ss a 100000
gd x2 +- r 0 x1
gd y2 +- b 0 x1
path
M l x1
L x1 x1
L x1 t
L x2 t
L x2 x1
L r x1
L r y2
L x2 y2
L x2 b
L x1 b
L x1 y2
L l y2
Z

shape snip1Rect
av adj 16667
gd a pin 0 adj 50000
gd dx1 */ ss a 100000
gd x1 +- r 0 dx1
path
M l t
L x1 t
L r dx1
L r b
L l b
Z

shape round1Rect
av adj 16667
gd a pin 0 adj 50000
gd dx1 */ ss a 100000
gd x1 +- r 0 dx1
path
M l t
L x1 t
A dx1 dx1 3cd4 cd4
L r b
L l b
Z

shape round2SameRect
av adj1 16667
av adj2 0
gd a1 pin 0 adj1 50000
gd a2 pin 0 adj2 50000
gd tx1 */ ss a1 100000
gd tx2 +- r 0 tx1
gd bx1 */ ss a2 100000
gd bx2 +- r 0 bx1
gd by1 +- b 0 bx1
path
M tx1 t
L tx2 t
A tx1 tx1 3cd4 cd4
L r by1
A bx1 bx1 0 cd4
L bx1 b
A bx1 bx1 cd4 cd4
L l tx1
A tx1 tx1 cd2 cd4
Z

shape flowChartProcess
path w=1 h=1
M 0 0
L 1 0
L 1 1
L 0 1
Z

shape flowChartAlternateProcess
gd x2 +- r 0 ssd6
gd y2 +- b 0 ssd6
path
M l ssd6
A ssd6 ssd6 cd2 cd4
L x2 t
A ssd6 ssd6 3cd4 cd4
L r y2
A ssd6 ssd6 0 cd4
L ssd6 b
A ssd6 ssd6 cd4 cd4
Z

shape flowChartDecision
path w=2 h=2
M 0 1
L 1 0
L 2 1
L 1 2
Z

shape flowChartTerminator
path w=21600 h=21600
M 3475 0
L 18125 0
A 3475 10800 3cd4 cd2
L 3475 21600
A 3475 10800 cd4 cd2
Z

shape flowChartInputOutput
path w=5 h=5
M 0 5
L 1 0
L 5 0
L 4 5
Z

shape flowChartPredefinedProcess
path w=1 h=1
M 0 0
L 1 0
L 1 1
L 0 1
Z
path w=8 h=8 fill=none
M 1 0
L 1 8
M 7 0
L 7 8

shape line
path fill=none
M l t
L r b

shape straightConnector1
path fill=none
M l t
L r b

shape bentConnector2
path fill=none
M l t
L r t
L r b

shape bentConnector3
av adj1 50000
gd x1 */ w adj1 100000
path fill=none
M l t
L x1 t
L x1 b
L r b

shape donut
av adj 25000
gd a pin 0 adj 50000
gd dr */ ss a 100000
gd iwd2 +- wd2 0 dr
gd ihd2 +- hd2 0 dr
path
M l vc
A wd2 hd2 cd2 cd4
A wd2 hd2 3cd4 cd4
A wd2 hd2 0 cd4
A wd2 hd2 cd4 cd4
Z
M dr vc
A iwd2 ihd2 cd2 -5400000
A iwd2 ihd2 cd4 -5400000
A iwd2 ihd2 0 -5400000
A iwd2 ihd2 3cd4 -5400000
Z

shape frame
av adj1 12500
gd a1 pin 0 adj1 50000
gd x1 */ ss a1 100000
gd x4 +- r 0 x1
gd y4 +- b 0 x1
path
M l t
L r t
L r b
L l b
Z
M x1 x1
L x1 y4
L x4 y4
L x4 x1
Z

shape wedgeRectCallout
av adj1 -20833
av adj2 62500
gd dxPos */ w adj1 100000
gd dyPos */ h adj2 100000
gd xPos +- hc dxPos 0
gd yPos +- vc dyPos 0
gd dx */ dxPos h 1
gd dy */ dyPos w 1
gd adx abs dx
gd ady abs dy
gd dq +- adx 0 ady
gd xg1 ?: dxPos 7 2
gd xg2 ?: dxPos 10 5
gd x1 */ w xg1 12
gd x2 */ w xg2 12
gd yg1 ?: dyPos 7 2
gd yg2 ?: dyPos 10 5
gd y1 */ h yg1 12
gd y2 */ h yg2 12
gd t1 ?: dxPos l xPos
gd xl ?: dq l t1
gd t2 ?: dyPos x1 xPos
gd xt ?: dq t2 x1
gd t3 ?: dxPos xPos r
gd xr ?: dq r t3
gd t4 ?: dyPos xPos x1
gd xb ?: dq t4 x1
gd t5 ?: dxPos y1 yPos
gd yl ?: dq y1 t5
gd t6 ?: dyPos t yPos
gd yt ?: dq t6 t
gd t7 ?: dxPos yPos y1
gd yr ?: dq y1 t7
gd t8 ?: dyPos yPos b
gd yb ?: dq t8 b
path
M l t
L x1 t
L xt yt
L x2 t
L r t
L r y1
L xr yr
L r y2
L r b
L x2 b
L xb yb
L x1 b
L l b
L l y2
L xl yl
L l y1
Z

shape pie
av adj1 0
av adj2 16200000
gd stAng pin 0 adj1 21599999
gd enAng pin 0 adj2 21599999
gd sw1 +- enAng 0 stAng
gd sw2 +- sw1 21600000 0
gd swAng ?: sw1 sw1 sw2
gd wt1 sin wd2 stAng
gd ht1 cos hd2 stAng
gd dx1 cat2 wd2 ht1 wt1
gd dy1 sat2 hd2 ht1 wt1
gd x1 +- hc dx1 0
gd y1 +- vc dy1 0
path
M x1 y1
A wd2 hd2 stAng swAng
L hc vc
Z

shape arc
av adj1 16200000
av adj2 0
gd stAng pin 0 adj1 21599999
gd enAng pin 0 adj2 21599999
gd sw11 +- enAng 0 stAng
gd sw12 +- sw11 21600000 0
gd swAng ?: sw11 sw11 sw12
gd wt1 sin wd2 stAng
gd ht1 cos hd2 stAng
gd dx1 cat2 wd2 ht1 wt1
gd dy1 sat2 hd2 ht1 wt1
gd x1 +- hc dx1 0
gd y1 +- vc dy1 0
path fill=none
M x1 y1
A wd2 hd2 stAng swAng

shape can
av adj 25000
gd maxAdj */ 50000 h ss
gd a pin 0 adj maxAdj
gd y1 */ ss a 200000
gd y2 +- y1 y1 0
gd y3 +- b 0 y1
path stroke=0
M l y1
A wd2 y1 cd2 -10800000
L r y3
A wd2 y1 0 cd2
Z
path stroke=0 fill=lighten
M l y1
A wd2 y1 cd2 cd2
A wd2 y1 0 cd2
Z
path fill=none
M r y1
A wd2 y1 0 cd2
A wd2 y1 cd2 cd2
L r y3
A wd2 y1 0 cd2
L l y1

shape heart
gd dx1 */ w 49 48
gd dx2 */ w 10 48
gd x1 +- hc 0 dx1
gd x2 +- hc 0 dx2
gd x3 +- hc dx2 0
gd x4 +- hc dx1 0
gd y1 +- t 0 hd3
path
M hc hd4
C x3 y1 x4 hd4 hc b
C x1 hd4 x2 y1 hc hd4
Z

shape cube
av adj 25000
gd a pin 0 adj 100000
gd y1 */ ss a 100000
gd y4 +- b 0 y1
gd x4 +- r 0 y1
path stroke=0
M l y1
L x4 y1
L x4 b
L l b
Z
path stroke=0 fill=darkenLess
M x4 y1
L r t
L r y4
L x4 b
Z
path stroke=0 fill=lightenLess
M l y1
L y1 t
L r t
L x4 y1
Z
path fill=none
M l y1
L y1 t
L r t
L r y4
L x4 b
L l b
Z
M l y1
L x4 y1
L r t
M x4 y1
L x4 b
`;

function parse(src: string): Map<string, GeomDef> {
  const out = new Map<string, GeomDef>();
  let cur: GeomDef | undefined;
  let path: GeomPath | undefined;
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const [head, ...rest] = line.split(/\s+/);
    if (head === 'shape') {
      cur = { av: [], gd: [], paths: [] };
      out.set(rest[0], cur);
      path = undefined;
    } else if (!cur) {
      continue;
    } else if (head === 'av') {
      const f = rest.slice(1).join(' ');
      cur.av.push([rest[0], /^-?\d+$/.test(f) ? `val ${f}` : f]);
    } else if (head === 'gd') {
      cur.gd.push([rest[0], rest.slice(1).join(' ')]);
    } else if (head === 'path') {
      const kv = Object.fromEntries(rest.map((s) => s.split('=')));
      path = {
        w: kv.w ? Number(kv.w) : undefined, h: kv.h ? Number(kv.h) : undefined,
        fill: (kv.fill as GeomPath['fill']) ?? 'norm', stroke: kv.stroke !== '0', cmds: [],
      };
      cur.paths.push(path);
    } else if (path && 'MLACQZ'.includes(head)) {
      path.cmds.push({ op: head as GeomPath['cmds'][number]['op'], args: rest });
    }
  }
  return out;
}

export const PRESETS = parse(SRC);

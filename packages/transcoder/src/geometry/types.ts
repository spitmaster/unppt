/** 形状几何定义（ECMA-376 的 a:custGeom / 预设形状定义）的数据结构 */
export interface GeomCmd { op: 'M' | 'L' | 'A' | 'C' | 'Q' | 'Z'; args: string[]; }
/** emu：文档里的 custGeom 没写 w / h，坐标就是形状自己的 EMU */
export interface GeomPath { w?: number; h?: number; emu?: boolean; fill: 'norm' | 'none' | 'lighten' | 'darken' | 'lightenLess' | 'darkenLess'; stroke: boolean; cmds: GeomCmd[]; }
export interface GeomDef { av: [string, string][]; gd: [string, string][]; paths: GeomPath[]; rect?: [string, string, string, string]; }

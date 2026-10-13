/** 形状几何定义（ECMA-376 的 a:custGeom / 预设形状定义）的数据结构 */
export interface GeomCmd { op: 'M' | 'L' | 'A' | 'C' | 'Q' | 'Z'; args: string[]; }
export interface GeomPath { w?: number; h?: number; fill: 'norm' | 'none' | 'lighten' | 'darken' | 'lightenLess' | 'darkenLess'; stroke: boolean; cmds: GeomCmd[]; }
export interface GeomDef { av: [string, string][]; gd: [string, string][]; paths: GeomPath[]; rect?: [string, string, string, string]; }

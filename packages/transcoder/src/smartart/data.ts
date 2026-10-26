/**
 * SmartArt 的数据模型（diagramData 的 dgm:dataModel）：文档点下面一棵节点树（dgm:cxn 的 parOf 连接，按 srcOrd 排），
 * 每个节点带文字（dgm:t）；还有"呈现点"（type="pres"）：版式里每个形状一个，presAssocID 指向它画的数据节点、presName 是
 * 版式节点的名字（parTx 等），绘图缓存里形状的 modelId 就是它的 id（"逐个"动画的目标，见 common/uid.ts）
 */
import { attr, child, children, numAttr, type XEl } from '../io/xml';

export interface DgmPoint {
  id: string;
  /** node（没写时）、doc、asst、pres、parTrans、sibTrans */
  type: string;
  el: XEl;
}

export interface DgmNode {
  pt: DgmPoint;
  children: DgmNode[];
  /** 文字（dgm:t，结构和 a:txBody 一样） */
  text?: XEl;
  /** 连到这个节点的连接带的转换点：和下一个兄弟之间（sibTrans，流程图的箭头）、和父节点之间（parTrans，层次结构的连线） */
  sibTrans?: DgmPoint;
  parTrans?: DgmPoint;
}

export interface DiagramData {
  /** 文档点（type="doc"）；它的 children 是第一层节点 */
  root: DgmNode;
  /** 呈现点：数据节点 id + 版式节点名 -> 呈现点 */
  pres(nodeId: string, presName: string): DgmPoint | undefined;
}

export function readDiagramData(dataModel: XEl): DiagramData | undefined {
  const pts = new Map<string, DgmPoint>();
  for (const p of children(child(dataModel, 'dgm:ptLst'), 'dgm:pt')) {
    const id = attr(p, 'modelId');
    if (id) pts.set(id, { id, type: attr(p, 'type') ?? 'node', el: p });
  }
  const doc = [...pts.values()].find((p) => p.type === 'doc');
  if (!doc) return undefined;
  // parOf 连接（没写 type 时就是 parOf）：父 -> 子，按 srcOrd 排；呈现点按 presAssocID / presName 查
  const kids = new Map<string, { ord: number; id: string; sib?: string; par?: string }[]>();
  for (const c of children(child(dataModel, 'dgm:cxnLst'), 'dgm:cxn')) {
    const type = attr(c, 'type') ?? 'parOf';
    if (type !== 'parOf') continue;
    const src = attr(c, 'srcId'), dest = attr(c, 'destId');
    if (!src || !dest || !pts.has(dest)) continue;
    const list = kids.get(src) ?? [];
    list.push({ ord: numAttr(c, 'srcOrd') ?? 0, id: dest, sib: attr(c, 'sibTransId'), par: attr(c, 'parTransId') });
    kids.set(src, list);
  }
  const pres = new Map<string, DgmPoint>();
  for (const p of pts.values()) {
    if (p.type !== 'pres') continue;
    const ps = child(p.el, 'dgm:prSet');
    const assoc = attr(ps, 'presAssocID'), name = attr(ps, 'presName');
    if (assoc && name && !pres.has(`${assoc}|${name}`)) pres.set(`${assoc}|${name}`, p);
  }
  const seen = new Set<string>();
  const build = (pt: DgmPoint): DgmNode => {
    seen.add(pt.id);
    const list = (kids.get(pt.id) ?? []).sort((a, b) => a.ord - b.ord);
    const nodes = list.filter((k) => { const p = pts.get(k.id)!; return (p.type === 'node' || p.type === 'asst') && !seen.has(p.id); });
    const out: DgmNode = { pt, children: [], text: child(pt.el, 'dgm:t') };
    for (const k of nodes) {
      const c = build(pts.get(k.id)!);
      c.sibTrans = k.sib ? pts.get(k.sib) : undefined;
      c.parTrans = k.par ? pts.get(k.par) : undefined;
      out.children.push(c);
    }
    return out;
  };
  return { root: build(doc), pres: (nodeId, presName) => pres.get(`${nodeId}|${presName}`) };
}

/** 节点文字里所有的字（判断有没有文字、和绘图缓存对照用） */
export function nodeText(n: DgmNode): string {
  const out: string[] = [];
  const walk = (el: XEl | undefined) => {
    for (const c of el?.children ?? []) {
      if (c.name === 'a:t') out.push(c.text);
      else walk(c);
    }
  };
  walk(n.text);
  return out.join('');
}

/** 所有节点（先序，不含文档点） */
export function allNodes(root: DgmNode): DgmNode[] {
  const out: DgmNode[] = [];
  const walk = (n: DgmNode) => { for (const c of n.children) { out.push(c); walk(c); } };
  walk(root);
  return out;
}

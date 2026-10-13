/** 动画目标编号的拼法（渲染和动画编译两边一致；编号会写进 HTML 属性，只允许安全的字符） */

/** SmartArt 里一个形状的动画编号：框的编号 + d + modelId 的 32 位十六进制 */
export function dgmUid(uid: string, modelId: string | undefined): string | undefined {
  const hex = (modelId ?? '').replace(/[{}-]/g, '').toLowerCase();
  return /^[0-9a-f]{32}$/.test(hex) ? `${uid}d${hex}` : undefined;
}

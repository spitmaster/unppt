/** 内容哈希（FNV-1a 32 位，8 位十六进制）：只用来给产物文件名防缓存串版本，不是加密用途 */
export function contentHash(s: string | Uint8Array): string {
  let h = 0x811c9dc5;
  if (typeof s === 'string') {
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  } else {
    for (let i = 0; i < s.length; i++) { h ^= s[i]; h = Math.imul(h, 0x01000193); }
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

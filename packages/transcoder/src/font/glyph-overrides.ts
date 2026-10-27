// 由 tools/fonts/glyph_audit.py 生成，别手改。说明见 docs/zh/research/glyph-overrides.md
// 默认字体包显示时，这些原字体里的这些符号改用另一个开源字体画（字宽、排版不变，只换字形）：
// 课件里出现 ≥ 50 次、思源黑体 / 宋体画法相似度 < 0.6、换上的 ≥ 0.85 且提高 ≥ 0.3（括号里是相似度：现在 -> 换后）
export const GLYPH_OVERRIDES: Record<string, Record<number, string>> = {
  'dengxian': {
    0x00AE: 'Liberation Sans', // ® 0.49 -> 0.94
    0x00B2: 'Liberation Sans', // ² 0.41 -> 0.88
    0x00B3: 'Liberation Sans', // ³ 0.5 -> 0.91
    0x00B7: 'Liberation Sans', // · 0.21 -> 0.86
    0x00F7: 'Carlito', // ÷ 0.45 -> 0.87
    0x2018: 'Liberation Sans', // ‘ 0.0 -> 0.97
    0x2019: 'Carlito', // ’ 0.0 -> 0.96
    0x201C: 'Liberation Sans', // “ 0.03 -> 0.96
    0x201D: 'Carlito', // ” 0.01 -> 0.95
    0x221A: 'Liberation Sans', // √ 0.11 -> 0.98
  },
  'microsoft yahei': {
    0x2026: 'Carlito', // … 0.0 -> 0.97
    0x221A: 'Liberation Sans', // √ 0.12 -> 0.97
    0x2264: 'Liberation Sans', // ≤ 0.44 -> 0.95
    0x2265: 'Liberation Sans', // ≥ 0.44 -> 0.95
    0x25A1: 'Carlito', // □ 0.17 -> 0.95
    0x25CB: 'Liberation Sans', // ○ 0.0 -> 0.98
    0x25CF: 'Carlito', // ● 0.59 -> 0.99
  },
  'simhei': {
    0x221A: 'Carlito', // √ 0.08 -> 0.86
  },
  'simsun': {
    0x00D8: 'Caladea', // Ø 0.54 -> 0.88
  },
  '宋体': {
    0x00D8: 'Caladea', // Ø 0.54 -> 0.88
  },
  '微软雅黑': {
    0x2026: 'Carlito', // … 0.0 -> 0.97
    0x221A: 'Liberation Sans', // √ 0.12 -> 0.97
    0x2264: 'Liberation Sans', // ≤ 0.44 -> 0.95
    0x2265: 'Liberation Sans', // ≥ 0.44 -> 0.95
    0x25A1: 'Carlito', // □ 0.17 -> 0.95
    0x25CB: 'Liberation Sans', // ○ 0.0 -> 0.98
    0x25CF: 'Carlito', // ● 0.59 -> 0.99
  },
  '等线': {
    0x00AE: 'Liberation Sans', // ® 0.49 -> 0.94
    0x00B2: 'Liberation Sans', // ² 0.41 -> 0.88
    0x00B3: 'Liberation Sans', // ³ 0.5 -> 0.91
    0x00B7: 'Liberation Sans', // · 0.21 -> 0.86
    0x00F7: 'Carlito', // ÷ 0.45 -> 0.87
    0x2018: 'Liberation Sans', // ‘ 0.0 -> 0.97
    0x2019: 'Carlito', // ’ 0.0 -> 0.96
    0x201C: 'Liberation Sans', // “ 0.03 -> 0.96
    0x201D: 'Carlito', // ” 0.01 -> 0.95
    0x221A: 'Liberation Sans', // √ 0.11 -> 0.98
  },
  '黑体': {
    0x221A: 'Carlito', // √ 0.08 -> 0.86
  },
};

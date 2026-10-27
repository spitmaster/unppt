// 演示站（GitHub Pages）构建：把挑出来的合成用例（testcases/，中性内容，本来就公开）用命令行转好，复制 PowerPoint 参考图，
// 和 site/ 下的页面一起放进 .cache/site。用法：npm run build && node site/build.mjs；发布见 site/README.md。
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const out = join(root, '.cache', 'site');
const cli = join(root, 'packages', 'transcoder', 'dist', 'cli.js');

// 演示用例：名字、中英文标题、一句话说明
const DEMOS = [
  ['shapes-all', '各种形状', 'Shapes', '187 种预设形状、填充、线条', 'Preset shapes, fills and lines'],
  ['fonts-showcase', '字体', 'Fonts', '字体打包进产物，所有观看者看到的一样', 'Fonts are embedded, every viewer sees the same'],
  ['charts-basic', '图表', 'Charts', '柱形、折线、饼图……按 PowerPoint 的规则排坐标轴和标签', 'Bar, line, pie… axes and labels laid out like PowerPoint'],
  ['charts-more', '更多图表', 'More charts', '面积、雷达、散点、组合图', 'Area, radar, scatter, combo'],
  ['charts-3d', '三维图表', '3-D charts', '三维柱形、饼图', '3-D bar and pie'],
  ['smartart', 'SmartArt', 'SmartArt', '流程、层次、循环', 'Process, hierarchy, cycle'],
  ['table-styles', '表格', 'Tables', '内置表格样式、合并单元格', 'Built-in table styles, merged cells'],
  ['text-warp', '艺术字', 'WordArt', '40 种文字变形', '40 text warps'],
  ['equations', '公式', 'Equations', 'Office 数学公式', 'Office math'],
  ['shapes-3d', '三维形状', '3-D shapes', '棱台、三维旋转、光照', 'Bevels, 3-D rotation, lighting'],
  ['transitions', '页面切换', 'Transitions', '淡出、推进、擦除、形状……', 'Fade, push, wipe, shape…'],
  ['anim-basic', '动画', 'Animations', '进入、强调、退出，按点击分步', 'Entrance, emphasis, exit, click by click'],
  ['anim-path', '路径动画', 'Motion paths', '沿路径移动', 'Motion along a path'],
  ['media-video', '视频', 'Video', '页面里的视频', 'Video on a slide'],
];

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'demos'), { recursive: true });
const list = [];
for (const [name, zh, en, dzh, den] of DEMOS) {
  const src = join(root, 'testcases', `${name}.pptx`);
  if (!existsSync(src)) { console.warn('缺用例', name); continue; }
  const dir = join(out, 'demos', name);
  execFileSync('node', [cli, src, '-o', dir, '-q', '--jobs', '2'], { stdio: 'inherit' });
  // PowerPoint 导出的参考图（每页最终的样子）
  const refDir = join(root, 'testcases', name);
  const refs = readdirSync(refDir).filter((f) => /^slide-\d{3}\.png$/.test(f)).sort();
  if (!refs.length) { console.warn('没有逐页参考图，跳过', name); rmSync(dir, { recursive: true, force: true }); continue; }
  mkdirSync(join(dir, 'ref'), { recursive: true });
  for (const f of refs) cpSync(join(refDir, f), join(dir, 'ref', f));
  list.push({ name, title: { zh, en }, desc: { zh: dzh, en: den }, slides: refs.length });
  console.log('转好', name, refs.length, '页');
}
writeFileSync(join(out, 'demos.json'), JSON.stringify(list, null, 1));
for (const f of readdirSync(join(root, 'site'))) if (/\.(html|css|js|svg)$/.test(f)) cpSync(join(root, 'site', f), join(out, f));
cpSync(join(root, 'packages', 'player', 'dist', 'host.js'), join(out, 'host.js'));
// 测试报告的数字（首页用）：从 docs/zh/test-report.md 的"一句话结论"里取
const report = readFileSync(join(root, 'docs', 'zh', 'test-report.md'), 'utf8');
const num = (re) => (report.match(re) || [])[1];
writeFileSync(join(out, 'stats.json'), JSON.stringify({
  decks: num(/\*\*(\d+) 份真实课件/), slides: num(/、(\d+) 页全部能转换/), fails: num(/失败 (\d+) 份/),
  ssim: num(/平均相似度 ([\d.]+)/), p95: num(/\*\*([\d.]+)% 的页达到 0\.95/), p90: num(/([\d.]+)% 的页在 0\.90 以上/),
  tcFiles: num(/测试课件 (\d+) 份/), tcSsim: num(/测试课件 \d+ 份、\d+ 页：平均相似度 ([\d.]+)/),
  sec: num(/一半的课件 ([\d.]+) 秒内/),
}, null, 1));
writeFileSync(join(out, '.nojekyll'), '');
console.log('演示站 ->', out);

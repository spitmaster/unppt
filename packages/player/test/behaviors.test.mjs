// 动画行为：PowerPoint 公式求值、加减速时间变换（源码用 esbuild 现场打包后测试）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function load(entry) {
  const r = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'neutral', logLevel: 'silent' });
  return import('data:text/javascript;base64,' + Buffer.from(r.outputFiles[0].text).toString('base64'));
}

test('公式：PowerPoint 预设里的写法', async () => {
  const { evalFormula } = await load('packages/player/src/anim/formula.ts');
  const v = { ppt_x: 0.4, ppt_y: 0.5, ppt_w: 0.2, ppt_h: 0.3 };
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);
  near(evalFormula('1+#ppt_h/2', v), 1.15);
  near(evalFormula('0-#ppt_w/2', v), -0.1);
  near(evalFormula('#ppt_y+#ppt_h*1.125000', v), 0.8375);
  near(evalFormula('#ppt_y-sin(pi*$)/3', { ...v, $: 0.5 }), 0.5 - 1 / 3);
  near(evalFormula('#ppt_w*sin(2.5*pi*$)', { ...v, $: 0.2 }), 0.2);
  near(evalFormula('#ppt_y+.1', v), 0.6);
  near(evalFormula('2+3*4^2', v), 50);
  near(evalFormula('max(1, min(5, 3))', v), 3);
});

test('公式：写错、不认识的名字得到 NaN，不会出错', async () => {
  const { evalFormula } = await load('packages/player/src/anim/formula.ts');
  for (const s of ['(1+', '1+*2', 'foo(1)', 'constructor', '#ppt_q', '1 2', 'alert(1)', '']) assert.ok(Number.isNaN(evalFormula(s, { ppt_x: 1 })), s);
});

test('加速、减速：两端平滑、总进度不变、单调', async () => {
  const { easeAccel } = await load('packages/player/src/anim/behaviors.ts');
  assert.equal(easeAccel(0.3), 0.3);
  for (const [a, d] of [[0.5, 0.5], [1, 0], [0, 1], [0.2, 0.3]]) {
    assert.ok(Math.abs(easeAccel(0, a, d)) < 1e-9 && Math.abs(easeAccel(1, a, d) - 1) < 1e-9);
    let prev = -1;
    for (let i = 0; i <= 100; i++) {
      const v = easeAccel(i / 100, a, d);
      assert.ok(v >= prev - 1e-12, `不单调 ${a},${d}`);
      prev = v;
    }
  }
  assert.ok(Math.abs(easeAccel(0.5, 0.5, 0.5) - 0.5) < 1e-9);
});

/** 产物形式的注册表（扩展点见 output.ts） */
import { dataForm } from './data';
import type { OutputForm } from './output';
import { singleForm } from './single';

export const OUTPUT_FORMS: readonly OutputForm[] = [singleForm, dataForm];

/** 按名字找；html 是 single 的旧名字 */
export function outputForm(name: string | undefined): OutputForm {
  const n = !name || name === 'html' ? 'single' : name;
  const f = OUTPUT_FORMS.find((x) => x.name === n);
  if (!f) throw new Error(`不认识的产物形式：${name}（可选 ${OUTPUT_FORMS.map((x) => x.name).join('、')}）`);
  return f;
}

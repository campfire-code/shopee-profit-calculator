// 生成 samples/ 里的示例文件（只在设置了 MAKE_SAMPLES=1 时运行）
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { writeXlsx } from './xlsx';
import { SAMPLE_GRID } from './samples';

it.runIf(process.env.MAKE_SAMPLES === '1')('生成示例文件', async () => {
  const [header, ...rows] = SAMPLE_GRID;
  const bytes = await writeXlsx([{ name: '批量计算', header: header as string[], rows, formats: ['text', 'text', 'text', 'money', 'money', 'money', 'money', 'money', 'int'] }], '篝火 · 虾皮选品利润计算器');
  writeFileSync('samples/批量计算示例.xlsx', bytes);
});

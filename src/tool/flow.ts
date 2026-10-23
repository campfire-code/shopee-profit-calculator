// 批量计算的文件流程：读表格 → 计算 → 导出带结果的 Excel。读写都经过 ctx，测试里可以换成内存文件系统。
import type { CustomTool } from '../kit/types';
import { baseName } from './common';
import { BATCH_HEADER, RESULT_HEADER, parseBatch, resultRows, type BatchRow, type SiteConfig } from './core';
import { readSheets, writeXlsx, type ColFmt } from './xlsx';

type Ctx = Parameters<CustomTool['Main']>[0]['ctx'];

export interface LoadedBatch {
  name: string;
  path: string;
  rows: BatchRow[];
}

export async function loadBatch(ctx: Ctx, path: string, sites: SiteConfig[], fallbackSite: string): Promise<LoadedBatch> {
  const name = path.split(/[\\/]/).pop() || path;
  if (/\.xls$/i.test(name)) throw new Error('旧版 .xls 格式不支持，请用 Excel 或 WPS 另存为 .xlsx');
  if (!/\.(xlsx|csv)$/i.test(name)) throw new Error('只支持 .xlsx 和 .csv 表格');
  const sheets = await readSheets(await ctx.readFile(path), name);
  const sheet = sheets.find((s) => s.grid.some((r) => r.length));
  if (!sheet) throw new Error('表格是空的');
  const { rows, missing } = parseBatch(sheet.grid, sites, fallbackSite);
  if (missing.length) throw new Error(`表格里找不到这些列：${missing.join('、')}。可以先点「下载模板」照着填`);
  if (!rows.length) throw new Error('表格只有表头，没有商品');
  return { name, path, rows };
}

const RESULT_FMT: ColFmt[] = ['int', 'text', 'text', 'text', 'text', 'money', 'money', 'money', 'money', 'money', 'money', 'money', 'money', 'text', 'money', 'money', 'money', 'money', 'money', 'money', 'pct', 'pct', 'money', 'text'];

/** 默认导出文件名：「原名-利润计算.xlsx」 */
export const exportName = (batch: LoadedBatch) => `${baseName(batch.name)}-利润计算.xlsx`;

/** 把计算结果和所用费率写成 Excel，返回写入的路径 */
export async function exportBatch(ctx: Ctx, batch: LoadedBatch, sites: SiteConfig[], out: string): Promise<string> {
  const used = sites.filter((s) => batch.rows.some((r) => r.siteId === s.id));
  const rateRows = used.map((s) => [s.name, s.currency, s.rate, s.commission / 100, s.transaction / 100, s.service / 100, s.payout / 100, s.firstWeight, s.firstFee, s.stepWeight, s.stepFee]);
  const bytes = await writeXlsx([
    { name: '利润计算', header: RESULT_HEADER, rows: resultRows(batch.rows, sites), formats: RESULT_FMT },
    {
      name: '所用费率（请以平台为准）',
      header: ['站点', '币种', '汇率(1当地币=人民币)', '佣金率', '交易手续费率', '服务费率', '提现手续费率', '首重(克)', '首重费', '续重单位(克)', '续重费'],
      rows: rateRows,
      formats: ['text', 'text', 'text', 'pct', 'pct', 'pct', 'pct', 'int', 'money', 'int', 'money'],
    },
  ], '篝火 · 虾皮选品利润计算器');
  await ctx.writeFile(out, bytes);
  return out;
}

/** 批量模板：表头 + 两行示例 */
export async function templateBytes(): Promise<Uint8Array> {
  return writeXlsx([{
    name: '批量计算',
    header: BATCH_HEADER,
    rows: [
      ['DEMO-001', '示例：不锈钢保温杯 500ml', '马来西亚', 39.9, 0, 18.5, 1.5, 0.5, 380],
      ['DEMO-002', '示例：帆布托特包', '新加坡', 12.9, 0, 9.8, 1.2, 0.3, 220],
    ],
    formats: ['text', 'text', 'text', 'money', 'money', 'money', 'money', 'money', 'int'],
  }], '篝火 · 虾皮选品利润计算器');
}

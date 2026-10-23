import { describe, expect, it } from 'vitest';
import { calcProfit, needsRate, parseBatch } from './core';
import { exportBatch, exportName, loadBatch, templateBytes } from './flow';
import { readSheets } from './xlsx';
import { SAMPLE_BATCH, SAMPLE_GRID, SAMPLE_SITES } from './samples';
import { writeXlsx } from './xlsx';

// 内存文件系统
function memCtx() {
  const files = new Map<string, Uint8Array>();
  const ctx = {
    readFile: async (p: string) => { const b = files.get(p); if (!b) throw new Error('没有 ' + p); return b; },
    writeFile: async (p: string, b: Uint8Array) => { files.set(p, b); },
  } as unknown as Parameters<typeof loadBatch>[0];
  return { files, ctx };
}

describe('示例数据', () => {
  it('演示站点都填了汇率', () => {
    expect(SAMPLE_SITES.filter((s) => ['sg', 'my', 'th'].includes(s.id)).every((s) => !needsRate(s))).toBe(true);
  });
  it('DEMO-001 马来西亚：逐项手算', () => {
    // 售价 39.9，佣金 5% = 1.995，交易手续费 2% = 0.798，物流 380g：3 + ceil(330/10)×0.3 = 12.9
    // 回款 39.9 - 1.995 - 0.798 - 12.9 = 24.207 MYR × 1.5 = 36.3105 元；成本 18.5 + 1.5 + 0.5 = 20.5
    const { rows } = parseBatch(SAMPLE_GRID, SAMPLE_SITES, 'my');
    const r = rows[0].result!;
    expect(r.logistics).toBeCloseTo(12.9);
    expect(r.netCny).toBeCloseTo(36.3105);
    expect(r.profit).toBeCloseTo(15.8105);
    expect(r.margin).toBeCloseTo(15.8105 / (39.9 * 1.5));
  });
  it('样例里有亏损行和不认识站点的错误行', () => {
    const { rows } = parseBatch(SAMPLE_GRID, SAMPLE_SITES, 'my');
    expect(rows[3].result!.profit).toBeLessThan(0); // DEMO-004
    expect(rows[4].error).toContain('火星站');
    expect(rows[3].result!.breakeven).toBeGreaterThan(25);
  });
});

describe('批量流程', () => {
  it('模板可以被自己读回来并算出结果', async () => {
    const { ctx, files } = memCtx();
    files.set('/t/模板.xlsx', await templateBytes());
    const b = await loadBatch(ctx, '/t/模板.xlsx', SAMPLE_SITES, 'my');
    expect(b.rows).toHaveLength(2);
    expect(b.rows.every((r) => r.result)).toBe(true);
  });
  it('缺必需列时说明缺哪些', async () => {
    const { ctx, files } = memCtx();
    files.set('/t/坏.xlsx', await writeXlsx([{ name: 's', header: ['SKU', '售价'], rows: [['a', 1]] }]));
    await expect(loadBatch(ctx, '/t/坏.xlsx', SAMPLE_SITES, 'my')).rejects.toThrow('采购成本、重量(克)');
  });
  it('拒绝 .xls 和其他格式', async () => {
    const { ctx } = memCtx();
    await expect(loadBatch(ctx, '/t/a.xls', SAMPLE_SITES, 'my')).rejects.toThrow('.xls');
    await expect(loadBatch(ctx, '/t/a.pdf', SAMPLE_SITES, 'my')).rejects.toThrow('只支持');
  });
  it('导出：结果表 + 所用费率表，行数与利润一致', async () => {
    const { ctx, files } = memCtx();
    const b = SAMPLE_BATCH(SAMPLE_SITES, 'my');
    expect(exportName(b)).toBe('批量计算示例-利润计算.xlsx');
    await exportBatch(ctx, b, SAMPLE_SITES, '/o/结果.xlsx');
    const sheets = await readSheets(files.get('/o/结果.xlsx')!, '结果.xlsx');
    expect(sheets.map((s) => s.name)).toEqual(['利润计算', '所用费率（请以平台为准）']);
    expect(sheets[0].grid).toHaveLength(1 + b.rows.length);
    const col = sheets[0].grid[0].indexOf('利润(人民币)');
    expect(Number(sheets[0].grid[1][col])).toBeCloseTo(calcProfit(b.rows[0].input, SAMPLE_SITES[1]).profit, 2);
    expect(sheets[1].grid.length).toBe(1 + 3); // my、sg、th
  });
});

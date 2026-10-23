import { describe, expect, it } from 'vitest';
import { DEFAULT_SITES, batchSummary, calcProfit, checkSite, logisticsFee, mergeSites, needsRate, parseBatch, priceForMargin, resolveSite, resultRows, type SiteConfig } from './core';

// 测试用的站点：数字取整好算，与默认示例值无关
const site: SiteConfig = { id: 't', name: '测试站', currency: 'TST', rate: 2, commission: 10, transaction: 2, service: 3, payout: 1, firstWeight: 50, firstFee: 4, stepWeight: 10, stepFee: 0.5, decimals: 2 };
const input = { price: 100, buyerShipping: 5, cost: 80, domestic: 5, other: 3, weight: 120 };

describe('物流费', () => {
  it('首重以内只收首重费', () => expect(logisticsFee(50, site)).toBe(4));
  it('超出部分按续重单位向上取整', () => {
    expect(logisticsFee(51, site)).toBe(4.5);
    expect(logisticsFee(120, site)).toBe(4 + 7 * 0.5);
  });
  it('重量为 0 不收物流费', () => expect(logisticsFee(0, site)).toBe(0));
});

describe('利润', () => {
  it('逐项手算核对', () => {
    const r = calcProfit(input, site);
    expect(r.commission).toBeCloseTo(10);
    expect(r.transaction).toBeCloseTo(2.1); // (100 + 5) × 2%
    expect(r.service).toBeCloseTo(3);
    expect(r.logistics).toBeCloseTo(7.5);
    expect(r.settlement).toBeCloseTo(105 - 10 - 2.1 - 3 - 7.5); // 82.4
    expect(r.payoutFee).toBeCloseTo(0.824);
    expect(r.net).toBeCloseTo(81.576);
    expect(r.netCny).toBeCloseTo(163.152);
    expect(r.costCny).toBe(88);
    expect(r.profit).toBeCloseTo(75.152);
    expect(r.margin).toBeCloseTo(75.152 / 200);
    expect(r.roi).toBeCloseTo(75.152 / 88);
  });
  it('按保本售价重新计算，利润为 0', () => {
    const be = calcProfit(input, site).breakeven!;
    expect(be).toBeGreaterThan(0);
    expect(calcProfit({ ...input, price: be }, site).profit).toBeCloseTo(0, 6);
  });
  it('按目标利润率反推售价，算回来正好是该利润率', () => {
    const p = priceForMargin(input, site, 0.25)!;
    expect(calcProfit({ ...input, price: p }, site).margin).toBeCloseTo(0.25, 6);
  });
  it('费率加目标利润率超过 100% 时无解', () => {
    expect(priceForMargin(input, { ...site, commission: 60 }, 0.4)).toBeNull();
  });
  it('售价为 0 时利润率为空，不报错', () => {
    const r = calcProfit({ ...input, price: 0 }, site);
    expect(r.margin).toBeNull();
    expect(r.profit).toBeLessThan(0);
  });
});

describe('站点模板', () => {
  it('默认站点不预置任何汇率和费率（未核实的数字一律由用户填写）', () => {
    for (const s of DEFAULT_SITES) {
      expect(needsRate(s)).toBe(true);
      expect([s.commission, s.transaction, s.service, s.payout, s.firstFee, s.stepFee, s.firstWeight, s.stepWeight]).toEqual(Array(8).fill(0));
    }
    expect(needsRate(site)).toBe(false);
    expect(checkSite(site)).toEqual([]);
  });
  it('费率越界时提示', () => {
    expect(checkSite({ ...site, commission: 120 })).toContain('佣金率应在 0～100% 之间');
    expect(checkSite({ ...site, rate: 0 })).toContain('汇率要大于 0');
  });
  it('合并保存的模板：保留改过的数字，忽略坏值和改名', () => {
    const merged = mergeSites([{ id: 'sg', commission: 9.5, rate: 'x', name: '乱改' }, null]);
    const sg = merged.find((s) => s.id === 'sg')!;
    expect(sg.commission).toBe(9.5);
    expect(sg.rate).toBe(0);
    expect(sg.name).toBe('新加坡');
    expect(merged).toHaveLength(DEFAULT_SITES.length);
    expect(mergeSites('坏数据')).toEqual(DEFAULT_SITES);
  });
  it('站点可以写中文名、代码或币种', () => {
    expect(resolveSite('马来西亚', DEFAULT_SITES)?.id).toBe('my');
    expect(resolveSite('PHP', DEFAULT_SITES)?.id).toBe('ph');
    expect(resolveSite('vn', DEFAULT_SITES)?.id).toBe('vn');
    expect(resolveSite('台湾', DEFAULT_SITES)?.id).toBe('tw');
    expect(resolveSite('火星', DEFAULT_SITES)).toBeUndefined();
  });
});

describe('批量', () => {
  const sites = [site, ...DEFAULT_SITES];
  it('表头按关键词识别，站点列为空时用当前站点，错误行写明原因', () => {
    const grid = [
      ['货号', '商品名称', '站点', '售价', '采购成本', '重量(g)'],
      ['A1', '示例保温杯', '', 100, 80, 120],
      ['A2', '示例帆布包', '火星', 50, 10, 100],
      ['A3', '示例台灯', 't', '', 10, 100],
    ];
    const { rows, missing } = parseBatch(grid, sites, 't');
    expect(missing).toEqual([]);
    expect(rows[0].result!.profit).toBeCloseTo(calcProfit({ ...input, buyerShipping: 0, domestic: 0, other: 0 }, site).profit);
    expect(rows[1].error).toBe('不认识的站点「火星」');
    expect(rows[2].error).toBe('售价为空或不是数字');
    expect(rows.map((r) => r.line)).toEqual([2, 3, 4]);
    const s = batchSummary(rows);
    expect(s).toMatchObject({ total: 3, ok: 1, err: 2, loss: 0 });
    const out = resultRows(rows, sites);
    expect(out[0][1]).toBe('A1');
    expect(out[1][out[1].length - 1]).toBe('不认识的站点「火星」');
    expect(out.every((r) => r.length === 24)).toBe(true);
  });
  it('缺少必需列时列出缺哪些', () => {
    expect(parseBatch([['SKU', '售价'], ['A', 1]], sites, 't').missing).toEqual(['采购成本', '重量(克)']);
  });
  it('数字里带千分位和货币符号也能识别', () => {
    const { rows } = parseBatch([['SKU', '售价', '采购成本', '重量'], ['B', '₫ 120,000', '¥30', '200g']], DEFAULT_SITES, 'vn');
    expect(rows[0].input).toMatchObject({ price: 120000, cost: 30, weight: 200 });
    expect(rows[0].result).toBeDefined();
  });
});

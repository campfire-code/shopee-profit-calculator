// 示例数据：samples/ 示例文件、README 验收用例、截图预览共用，测试里也会核对计算结果。
// 注意：下面的汇率和费率只是演示用的随手数字，不是 Shopee 官方费率，也不会预置进正式应用。
import { BATCH_HEADER, DEFAULT_SITES, parseBatch, type ItemInput, type SiteConfig } from './core';
import type { Cell } from './common';
import type { LoadedBatch } from './flow';

type Fill = Pick<SiteConfig, 'rate' | 'commission' | 'transaction' | 'service' | 'payout' | 'firstWeight' | 'firstFee' | 'stepWeight' | 'stepFee'>;
const DEMO: Record<string, Fill> = {
  sg: { rate: 5, commission: 5, transaction: 2, service: 0, payout: 0, firstWeight: 50, firstFee: 1.5, stepWeight: 10, stepFee: 0.2 },
  my: { rate: 1.5, commission: 5, transaction: 2, service: 0, payout: 0, firstWeight: 50, firstFee: 3, stepWeight: 10, stepFee: 0.3 },
  th: { rate: 0.2, commission: 5, transaction: 2, service: 0, payout: 0, firstWeight: 50, firstFee: 25, stepWeight: 10, stepFee: 3 },
};

/** 演示费率（仅用于预览截图、样例文件和测试；README 验收用例要求用户手动填入同样数字） */
export const SAMPLE_SITES: SiteConfig[] = DEFAULT_SITES.map((s) => ({ ...s, ...DEMO[s.id] }));

/** 单品页打开时的演示数据 */
export const SAMPLE_INPUT: { siteId: string; input: ItemInput; target: number } = {
  siteId: 'my',
  input: { price: 39.9, buyerShipping: 0, cost: 18.5, domestic: 1.5, other: 0.5, weight: 380 },
  target: 20,
};

/** 批量样例（对应 samples/批量计算示例.xlsx） */
export const SAMPLE_GRID: Cell[][] = [
  BATCH_HEADER,
  ['DEMO-001', '示例：不锈钢保温杯 500ml', '马来西亚', 39.9, 0, 18.5, 1.5, 0.5, 380],
  ['DEMO-002', '示例：帆布托特包', '新加坡', 12.9, 0, 9.8, 1.2, 0.3, 220],
  ['DEMO-003', '示例：手机支架', '泰国', 129, 0, 6.5, 0.8, 0.2, 90],
  ['DEMO-004', '示例：大号收纳箱', '马来西亚', 25, 0, 30, 5, 1, 1500],
  ['DEMO-005', '示例：数据线', '火星站', 9.9, 0, 2, 0.5, 0.1, 40],
  ['DEMO-006', '示例：硅胶厨具套装', '新加坡', 22.5, 3, 11, 1.2, 0.5, 450],
];

export function SAMPLE_BATCH(sites: SiteConfig[], siteId: string): LoadedBatch {
  return { name: '批量计算示例.xlsx', path: '/示例/批量计算示例.xlsx', rows: parseBatch(SAMPLE_GRID, sites, siteId).rows };
}

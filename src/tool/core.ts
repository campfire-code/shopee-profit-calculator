// 纯函数：利润计算、站点费率模板、批量表格解析与导出行。不依赖界面和本机能力，便于单元测试。
//
// 重要：本工具不预置任何 Shopee 费率、物流费和汇率，全部由用户自己填写（以平台为准）。
import { cellText, guessColumn, toTable, type Cell } from './common';

/** 一个站点的费率模板（金额单位：当地币；费率单位：%） */
export interface SiteConfig {
  id: string;
  name: string;
  currency: string;
  /** 1 当地币 = 多少人民币 */
  rate: number;
  /** 平台佣金率 %，按售价计 */
  commission: number;
  /** 交易手续费率 %，按买家实付（售价 + 买家支付的运费）计 */
  transaction: number;
  /** 其他服务费率 %（如参加的免运、返现等计划），按售价计 */
  service: number;
  /** 收款 / 提现手续费率 %，按平台结算金额计 */
  payout: number;
  /** 跨境物流：首重（克）、首重费（当地币）、续重单位（克）、续重费（当地币） */
  firstWeight: number;
  firstFee: number;
  stepWeight: number;
  stepFee: number;
  /** 金额显示保留几位小数（越南盾、印尼盾为 0） */
  decimals: number;
}

/**
 * 站点与币种（币种为 ISO 4217 代码）。
 * 汇率、佣金、手续费、物流费都没有预置：Shopee 各站点、类目、卖家计划的费率不同且经常调整，
 * 本工具没有核实过任何一个数字，一律留 0，由用户按 Shopee 卖家中心的官方信息自己填写。
 * decimals 只是金额显示的小数位（越南盾、印尼盾、新台币通常不显示小数）。
 */
const blank = { rate: 0, commission: 0, transaction: 0, service: 0, payout: 0, firstWeight: 0, firstFee: 0, stepWeight: 0, stepFee: 0 };
export const DEFAULT_SITES: SiteConfig[] = [
  { id: 'sg', name: '新加坡', currency: 'SGD', decimals: 2, ...blank },
  { id: 'my', name: '马来西亚', currency: 'MYR', decimals: 2, ...blank },
  { id: 'th', name: '泰国', currency: 'THB', decimals: 2, ...blank },
  { id: 'ph', name: '菲律宾', currency: 'PHP', decimals: 2, ...blank },
  { id: 'vn', name: '越南', currency: 'VND', decimals: 0, ...blank },
  { id: 'id', name: '印度尼西亚', currency: 'IDR', decimals: 0, ...blank },
  { id: 'tw', name: '中国台湾', currency: 'TWD', decimals: 0, ...blank },
  { id: 'br', name: '巴西', currency: 'BRL', decimals: 2, ...blank },
];

/** 汇率还没填，无法换算成人民币 */
export const needsRate = (s: SiteConfig) => !(s.rate > 0);

export const FEE_NOTICE = '汇率、佣金、手续费和物流费都需要你自己填写，工具没有预置任何官方数字。请以 Shopee 卖家中心的官方最新信息和当天汇率为准。';

/** 单个商品的输入 */
export interface ItemInput {
  /** 售价（当地币） */
  price: number;
  /** 买家支付的运费（当地币），没有填 0 */
  buyerShipping: number;
  /** 采购成本（人民币） */
  cost: number;
  /** 国内运费 / 头程（人民币） */
  domestic: number;
  /** 包装、贴标等其他成本（人民币） */
  other: number;
  /** 包裹重量（克） */
  weight: number;
}

export interface ProfitResult {
  /** 以下为当地币 */
  commission: number;
  transaction: number;
  service: number;
  logistics: number;
  settlement: number;
  payoutFee: number;
  net: number;
  /** 以下为人民币 */
  revenueCny: number;
  netCny: number;
  costCny: number;
  profit: number;
  /** 利润率 = 利润 ÷ 售价（换算成人民币后） */
  margin: number | null;
  /** 投入产出比 = 利润 ÷ 人民币成本合计 */
  roi: number | null;
  /** 保本售价（当地币）；费率过高无法保本时为 null */
  breakeven: number | null;
}

const pct = (v: number) => (Number.isFinite(v) ? v : 0) / 100;
const num = (v: number) => (Number.isFinite(v) ? v : 0);

/** 跨境物流费（当地币）：首重内收首重费，超出部分按续重单位向上取整 */
export function logisticsFee(weight: number, s: Pick<SiteConfig, 'firstWeight' | 'firstFee' | 'stepWeight' | 'stepFee'>): number {
  const w = num(weight);
  if (w <= 0) return 0;
  const extra = Math.max(0, w - num(s.firstWeight));
  const steps = s.stepWeight > 0 ? Math.ceil(extra / s.stepWeight - 1e-9) : 0;
  return num(s.firstFee) + steps * num(s.stepFee);
}

/**
 * 反推售价（当地币）：让利润率正好等于 targetMargin（0 表示保本）。
 * 利润 = 汇率 ×(1-提现费率)×[售价×(1-佣金-交易费-服务费) + 买家运费×(1-交易费) - 物流费] - 人民币成本
 * 令 利润 = 目标利润率 × 售价 × 汇率，解出售价。分母不大于 0 时说明费率加目标利润率已超过 100%，无解。
 */
export function priceForMargin(input: Omit<ItemInput, 'price'>, s: SiteConfig, targetMargin: number): number | null {
  if (!(s.rate > 0)) return null;
  const c = pct(s.commission), t = pct(s.transaction), sv = pct(s.service), p = pct(s.payout);
  const costCny = num(input.cost) + num(input.domestic) + num(input.other);
  const L = logisticsFee(input.weight, s);
  const B = num(input.buyerShipping);
  const denom = (1 - p) * (1 - c - t - sv) - targetMargin;
  if (denom <= 1e-9) return null;
  const price = (costCny / s.rate - (1 - p) * (B * (1 - t) - L)) / denom;
  return price > 0 ? price : 0;
}

export function calcProfit(input: ItemInput, s: SiteConfig): ProfitResult {
  const price = num(input.price);
  const B = num(input.buyerShipping);
  const commission = price * pct(s.commission);
  const transaction = (price + B) * pct(s.transaction);
  const service = price * pct(s.service);
  const logistics = logisticsFee(input.weight, s);
  const settlement = price + B - commission - transaction - service - logistics;
  const payoutFee = Math.max(0, settlement) * pct(s.payout);
  const net = settlement - payoutFee;
  const rate = num(s.rate);
  const revenueCny = price * rate;
  const netCny = net * rate;
  const costCny = num(input.cost) + num(input.domestic) + num(input.other);
  const profit = netCny - costCny;
  return {
    commission, transaction, service, logistics, settlement, payoutFee, net,
    revenueCny, netCny, costCny, profit,
    margin: revenueCny > 0 ? profit / revenueCny : null,
    roi: costCny > 0 ? profit / costCny : null,
    breakeven: priceForMargin(input, s, 0),
  };
}

/** 校验站点费率：返回问题列表（空数组表示没问题） */
export function checkSite(s: SiteConfig): string[] {
  const out: string[] = [];
  if (!(s.rate > 0)) out.push('汇率要大于 0');
  for (const [k, l] of [['commission', '佣金率'], ['transaction', '交易手续费率'], ['service', '服务费率'], ['payout', '提现手续费率']] as const) {
    if (s[k] < 0 || s[k] >= 100) out.push(`${l}应在 0～100% 之间`);
  }
  if (s.firstWeight < 0 || s.firstFee < 0 || s.stepWeight < 0 || s.stepFee < 0) out.push('物流费不能为负数');
  if (s.stepFee > 0 && !(s.stepWeight > 0)) out.push('填了续重费就要填续重单位');
  return out;
}

/** 把保存的模板和默认模板合并：保留用户改过的值，补上新增的字段和站点 */
export function mergeSites(saved: unknown): SiteConfig[] {
  const list = Array.isArray(saved) ? (saved as Partial<SiteConfig>[]) : [];
  return DEFAULT_SITES.map((d) => {
    const s = list.find((x) => x && x.id === d.id);
    if (!s) return d;
    const merged = { ...d };
    for (const k of Object.keys(d) as (keyof SiteConfig)[]) {
      const v = s[k];
      if (k === 'id' || k === 'name' || k === 'currency') continue;
      if (typeof v === 'number' && Number.isFinite(v)) (merged as Record<string, unknown>)[k] = v;
    }
    return merged;
  });
}

/** 按站点规定的小数位格式化金额 */
export function money(v: number, decimals = 2): string {
  if (!Number.isFinite(v)) return '-';
  return v.toLocaleString('zh-CN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
export const percent = (v: number | null) => (v == null || !Number.isFinite(v) ? '-' : `${(v * 100).toFixed(1)}%`);

/** 人民币金额保留两位小数（导出用，避免浮点尾数） */
export const round = (v: number, d = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : 0);

// ---------------- 批量 ----------------

export const BATCH_HEADER = ['SKU', '商品名称', '站点', '售价', '买家支付运费', '采购成本', '国内运费', '其他成本', '重量(克)'];

const COLS: Record<keyof ItemInput | 'sku' | 'name' | 'site', RegExp[]> = {
  sku: [/^sku$/i, /sku/i, /货号|编码|商品编号/],
  name: [/商品名称|商品名|品名|标题|名称/, /name|title/i],
  site: [/站点|国家|市场/, /site|market|country/i],
  price: [/^售价|销售价|^价格/, /售价|price/i],
  buyerShipping: [/买家.*运费|买家支付运费/, /buyer.*ship/i],
  cost: [/采购成本|进价|采购价|成本价/, /^cost/i],
  domestic: [/国内运费|头程/, /domestic/i],
  other: [/其他成本|包装/, /other/i],
  weight: [/重量/, /weight/i],
};

export interface BatchRow {
  line: number;
  sku: string;
  name: string;
  siteId: string;
  input: ItemInput;
  error?: string;
  result?: ProfitResult;
}

/** 站点列可以写中文名、站点代码（sg）或币种（SGD） */
export function resolveSite(text: string, sites: SiteConfig[]): SiteConfig | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  return sites.find((s) => s.id === t || s.currency.toLowerCase() === t || s.name === text.trim() || (t.length >= 2 && s.name.includes(text.trim())));
}

const toNum = (c: Cell): number => {
  if (typeof c === 'number') return c;
  const t = cellText(c).replace(/[,，\s]/g, '').replace(/[^\d.-]/g, '');
  return t ? Number(t) : NaN;
};

/** 解析批量表格：表头按关键词识别，站点列为空时用 fallbackSite */
export function parseBatch(grid: Cell[][], sites: SiteConfig[], fallbackSite: string): { rows: BatchRow[]; missing: string[] } {
  const table = toTable(grid);
  const idx = Object.fromEntries(Object.entries(COLS).map(([k, res]) => [k, guessColumn(table.header, res)])) as Record<keyof typeof COLS, number>;
  const missing = (['price', 'cost', 'weight'] as const).filter((k) => idx[k] < 0).map((k) => ({ price: '售价', cost: '采购成本', weight: '重量(克)' })[k]);
  if (missing.length) return { rows: [], missing };
  const get = (r: Cell[], k: keyof typeof COLS) => (idx[k] >= 0 ? r[idx[k]] : null);
  const rows = table.rows.map((r, i): BatchRow => {
    const siteText = cellText(get(r, 'site'));
    const site = siteText ? resolveSite(siteText, sites) : sites.find((s) => s.id === fallbackSite);
    const opt = (k: keyof typeof COLS) => { const v = toNum(get(r, k)); return Number.isFinite(v) ? v : 0; };
    const input: ItemInput = { price: toNum(get(r, 'price')), cost: toNum(get(r, 'cost')), weight: toNum(get(r, 'weight')), buyerShipping: opt('buyerShipping'), domestic: opt('domestic'), other: opt('other') };
    const row: BatchRow = { line: i + 2, sku: cellText(get(r, 'sku')), name: cellText(get(r, 'name')), siteId: site?.id ?? '', input };
    if (!site) row.error = `不认识的站点「${siteText}」`;
    else if (!(input.price > 0)) row.error = '售价为空或不是数字';
    else if (!Number.isFinite(input.cost)) row.error = '采购成本为空或不是数字';
    else if (!Number.isFinite(input.weight)) row.error = '重量为空或不是数字';
    else row.result = calcProfit(input, site);
    return row;
  });
  return { rows, missing: [] };
}

export const RESULT_HEADER = [
  '行号', 'SKU', '商品名称', '站点', '币种', '售价', '买家支付运费', '平台佣金', '交易手续费', '服务费', '跨境物流费', '提现手续费', '平台回款(当地币)',
  '汇率(1当地币=人民币)', '回款(人民币)', '采购成本', '国内运费', '其他成本', '成本合计(人民币)', '利润(人民币)', '利润率', '投入产出比', '保本售价(当地币)', '说明',
];

/** 批量结果转成导出行（金额保留两位小数，利润率等为小数，由 Excel 格式显示为百分比） */
export function resultRows(rows: BatchRow[], sites: SiteConfig[]): Cell[][] {
  return rows.map((r) => {
    const s = sites.find((x) => x.id === r.siteId);
    const x = r.result;
    if (!s || !x) return [r.line, r.sku, r.name, s?.name ?? '', s?.currency ?? '', ...Array(18).fill(null), r.error ?? ''];
    return [
      r.line, r.sku, r.name, s.name, s.currency, round(r.input.price), round(r.input.buyerShipping), round(x.commission), round(x.transaction), round(x.service), round(x.logistics), round(x.payoutFee), round(x.net),
      s.rate, round(x.netCny), round(r.input.cost), round(r.input.domestic), round(r.input.other), round(x.costCny), round(x.profit), x.margin == null ? null : round(x.margin, 4), x.roi == null ? null : round(x.roi, 4),
      x.breakeven == null ? null : round(x.breakeven), x.breakeven == null ? '费率合计过高，无法保本' : x.profit < 0 ? '亏损' : '',
    ];
  });
}

/** 批量汇总：成功条数、亏损条数、平均利润率 */
export function batchSummary(rows: BatchRow[]) {
  const ok = rows.filter((r) => r.result);
  const loss = ok.filter((r) => r.result!.profit < 0).length;
  const margins = ok.map((r) => r.result!.margin).filter((m): m is number => m != null);
  const avg = margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : null;
  return { total: rows.length, ok: ok.length, err: rows.length - ok.length, loss, avgMargin: avg };
}

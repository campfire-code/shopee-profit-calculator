// 主界面：单品计算 / 批量计算 / 费率设置 三个页签。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { Calculator, Download, FileSpreadsheet, FolderOpen, Info, RotateCcw, TriangleAlert, X } from 'lucide-react';
import type { CustomTool } from '../kit/types';
import { useDroppedFiles } from '../kit/parts';
import { pickFiles, reveal } from '../kit/platform';
import { DEFAULT_SITES, FEE_NOTICE, batchSummary, calcProfit, checkSite, money, needsRate, percent, priceForMargin, type ItemInput, type SiteConfig } from './core';
import { exportBatch, exportName, loadBatch, templateBytes, type LoadedBatch } from './flow';
import { loadLast, loadSites, saveLast, saveSites } from './store';
import { SAMPLE_BATCH, SAMPLE_INPUT, SAMPLE_SITES } from './samples';
import './tool.css';

type Ctx = Parameters<CustomTool['Main']>[0]['ctx'];
type Tab = 'single' | 'batch' | 'rates';
type Note = { kind: 'ok' | 'err'; text: string; path?: string };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
// 浏览器预览页（没有 Tauri 本机能力）：用演示费率和示例数据，便于截图
const IS_PREVIEW = typeof window === 'undefined' || !(window as unknown as { __TAURI_INTERNALS__?: { invoke?: unknown } }).__TAURI_INTERNALS__;
const NO_RATE = '还没填汇率';

export function Main({ ctx }: { ctx?: Ctx }) {
  const [tab, setTab] = useState<Tab>(() => (IS_PREVIEW ? (new URLSearchParams(location.search).get('tab') as Tab | null) : null) ?? 'single');
  const [sites, setSites] = useState<SiteConfig[]>(IS_PREVIEW ? SAMPLE_SITES : DEFAULT_SITES);
  const [siteId, setSiteId] = useState(SAMPLE_INPUT.siteId);
  const [input, setInput] = useState<ItemInput>(SAMPLE_INPUT.input);
  const [target, setTarget] = useState(SAMPLE_INPUT.target);
  const loaded = useRef(false);

  useEffect(() => {
    Promise.all([loadSites(), loadLast()]).then(([s, last]) => {
      if (s) setSites(s);
      if (last?.input) { setSiteId(last.siteId); setInput({ ...SAMPLE_INPUT.input, ...last.input }); setTarget(last.target ?? SAMPLE_INPUT.target); }
      loaded.current = true;
    });
  }, []);
  useEffect(() => { if (loaded.current) void saveLast({ siteId, input, target }); }, [siteId, input, target]);

  const updateSites = useCallback((fn: (s: SiteConfig[]) => SiteConfig[]) => {
    setSites((prev) => { const next = fn(prev); void saveSites(next); return next; });
  }, []);
  const site = sites.find((s) => s.id === siteId) ?? sites[0];

  return (
    <div className="sp-root">
      <div className="sp-tabs" role="tablist" aria-label="功能">
        {([['single', '单品计算'], ['batch', '批量计算'], ['rates', '费率设置']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={`k-chip${tab === k ? ' on' : ''}`} onClick={() => setTab(k)}>{l}</button>
        ))}
        <span className="sp-sp" />
        <span className="sp-warn-chip" title={FEE_NOTICE}><Info size={13} />费率需自己填写，以 Shopee 官方为准</span>
      </div>
      {tab === 'single' && <SingleTab site={site} sites={sites} siteId={siteId} setSiteId={setSiteId} input={input} setInput={setInput} target={target} setTarget={setTarget} goRates={() => setTab('rates')} />}
      {tab === 'batch' && <BatchTab ctx={ctx} sites={sites} siteId={site.id} />}
      {tab === 'rates' && <RatesTab sites={sites} update={updateSites} />}
    </div>
  );
}

// ---------------- 单品计算 ----------------

function Num({ id, label, value, onChange, unit, step = 0.01, help }: { id: string; label: string; value: number; onChange: (v: number) => void; unit?: string; step?: number; help?: string }) {
  return (
    <div className="k-field">
      <label className="k-label" htmlFor={id}>{label}</label>
      <span className="k-input-wrap">
        <input id={id} className="k-input" type="number" step={step} min={0} value={Number.isFinite(value) ? value : ''} onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))} />
        {unit && <span className="k-unit">{unit}</span>}
      </span>
      {help && <span className="k-help">{help}</span>}
    </div>
  );
}

function SingleTab(p: {
  site: SiteConfig; sites: SiteConfig[]; siteId: string; setSiteId: (v: string) => void;
  input: ItemInput; setInput: (v: ItemInput) => void; target: number; setTarget: (v: number) => void; goRates: () => void;
}) {
  const { site, input, setInput } = p;
  const r = useMemo(() => calcProfit(input, site), [input, site]);
  const targetPrice = useMemo(() => priceForMargin(input, site, p.target / 100), [input, site, p.target]);
  const set = (k: keyof ItemInput) => (v: number) => setInput({ ...input, [k]: v });
  const cur = site.currency;
  const m = (v: number) => money(v, site.decimals);
  const problems = checkSite(site);
  const loss = r.profit < 0;

  return (
    <div className="sp-single">
      <section className="k-panel sp-form">
        <div className="k-field">
          <label className="k-label" htmlFor="sp-site">站点</label>
          <select id="sp-site" className="k-input" value={p.siteId} onChange={(e) => p.setSiteId(e.target.value)}>
            {p.sites.map((s) => <option key={s.id} value={s.id}>{s.name}（{s.currency}）</option>)}
          </select>
        </div>
        <div className="sp-grid2">
          <Num id="sp-price" label="售价" unit={cur} value={input.price} onChange={set('price')} />
          <Num id="sp-bship" label="买家支付的运费" unit={cur} value={input.buyerShipping} onChange={set('buyerShipping')} help="没有就填 0" />
          <Num id="sp-cost" label="采购成本" unit="元" value={input.cost} onChange={set('cost')} />
          <Num id="sp-dom" label="国内运费 / 头程" unit="元" value={input.domestic} onChange={set('domestic')} />
          <Num id="sp-other" label="包装等其他成本" unit="元" value={input.other} onChange={set('other')} />
          <Num id="sp-weight" label="包裹重量" unit="克" step={1} value={input.weight} onChange={set('weight')} />
        </div>
        <div className="sp-rates-brief">
          <div className="sp-rates-hd"><b>{site.name}站费率</b><span className="k-muted">{IS_PREVIEW ? '演示数字，非官方' : '自己填写，以平台为准'}</span><span className="sp-sp" /><button className="k-link" onClick={p.goRates}>{needsRate(site) ? '去填写' : '修改费率'}</button></div>
          <span className="k-muted k-num">汇率 1 {cur} = {site.rate} 元 · 佣金 {site.commission}% · 交易手续费 {site.transaction}% · 服务费 {site.service}% · 提现 {site.payout}%</span>
          <span className="k-muted k-num">物流：首重 {site.firstWeight} 克 {m(site.firstFee)} {cur}，续重每 {site.stepWeight} 克 {m(site.stepFee)} {cur}</span>
          {!needsRate(site) && problems.length > 0 && <span className="k-err-text">{problems.join('；')}</span>}
        </div>
      </section>

      {needsRate(site) ? (
        <section className="k-panel sp-result sp-need" aria-live="polite">
          <TriangleAlert size={22} />
          <b>先填{site.name}站的汇率和费率</b>
          <span className="k-muted">本工具没有预置任何官方费率。请到 Shopee 卖家中心查好{site.name}站当前的佣金、手续费、物流费和汇率，填到「费率设置」里（只需填一次，自动保存在这台电脑上）。</span>
          <button className="k-btn primary" onClick={p.goRates}>去填写费率</button>
        </section>
      ) : (
      <section className="k-panel sp-result" aria-live="polite">
        <div className="sp-hero">
          <div>
            <span className="k-muted">到手利润（人民币）</span>
            <b className={`sp-big k-num${loss ? ' neg' : ''}`}>¥ {money(r.profit, 2)}</b>
          </div>
          <div className="sp-kpis">
            <span><small className="k-muted">利润率</small><b className={`k-num${loss ? ' neg' : ''}`}>{percent(r.margin)}</b></span>
            <span><small className="k-muted">投入产出比</small><b className="k-num">{percent(r.roi)}</b></span>
            <span><small className="k-muted">保本售价</small><b className="k-num">{r.breakeven == null ? '无法保本' : `${m(r.breakeven)} ${cur}`}</b></span>
          </div>
        </div>
        {loss && <div className="sp-alert"><TriangleAlert size={15} />按当前售价会亏损，售价至少要 {r.breakeven == null ? '—（费率合计过高）' : `${m(r.breakeven)} ${cur}`} 才能保本</div>}
        <table className="k-table sp-break">
          <tbody>
            <tr><td>售价</td><td className="k-num">{m(input.price)} {cur}</td></tr>
            {input.buyerShipping > 0 && <tr><td>+ 买家支付的运费</td><td className="k-num">{m(input.buyerShipping)} {cur}</td></tr>}
            <tr><td>− 平台佣金 <small className="k-muted">{site.commission}%</small></td><td className="k-num">{m(r.commission)} {cur}</td></tr>
            <tr><td>− 交易手续费 <small className="k-muted">{site.transaction}%</small></td><td className="k-num">{m(r.transaction)} {cur}</td></tr>
            {site.service > 0 && <tr><td>− 服务费 <small className="k-muted">{site.service}%</small></td><td className="k-num">{m(r.service)} {cur}</td></tr>}
            <tr><td>− 跨境物流费 <small className="k-muted">{input.weight} 克</small></td><td className="k-num">{m(r.logistics)} {cur}</td></tr>
            {site.payout > 0 && <tr><td>− 提现手续费 <small className="k-muted">{site.payout}%</small></td><td className="k-num">{m(r.payoutFee)} {cur}</td></tr>}
            <tr className="sp-sub"><td>= 平台回款</td><td className="k-num">{m(r.net)} {cur} ≈ ¥ {money(r.netCny, 2)}</td></tr>
            <tr><td>− 成本合计 <small className="k-muted">采购 + 国内运费 + 其他</small></td><td className="k-num">¥ {money(r.costCny, 2)}</td></tr>
            <tr className="sp-total"><td>= 利润</td><td className={`k-num${loss ? ' neg' : ''}`}>¥ {money(r.profit, 2)}</td></tr>
          </tbody>
        </table>
        <div className="sp-target">
          <Num id="sp-target" label="想要的利润率" unit="%" step={1} value={p.target} onChange={p.setTarget} />
          <div className="sp-target-out">
            <span className="k-muted">售价应定为</span>
            <b className="k-num">{targetPrice == null ? '达不到（费率加利润率超过 100%）' : `${m(targetPrice)} ${cur}`}</b>
          </div>
        </div>
        <p className="k-muted sp-foot">利润率 = 利润 ÷ 售价（按汇率换算）。佣金和服务费按售价计，交易手续费按售价加买家运费计。{FEE_NOTICE}</p>
      </section>
      )}
    </div>
  );
}

// ---------------- 批量计算 ----------------

const SHOW_ROWS = 300;

function BatchTab({ ctx, sites, siteId }: { ctx?: Ctx; sites: SiteConfig[]; siteId: string }) {
  const [batch, setBatch] = useState<LoadedBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const preview = !ctx || IS_PREVIEW;

  // 预览页（没有本机能力）直接展示示例批量结果，便于截图
  useEffect(() => { if (preview) setBatch(SAMPLE_BATCH(sites, siteId)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const open = useCallback(async (path: string) => {
    if (!ctx) return;
    setBusy(true); setNote(null);
    try { setBatch(await loadBatch(ctx, path, sites, siteId)); }
    catch (e) { setNote({ kind: 'err', text: errText(e) }); }
    setBusy(false);
  }, [ctx, sites, siteId]);
  const hover = useDroppedFiles((paths) => { if (paths[0]) void open(paths[0]); });
  const pick = async () => { const [p] = await pickFiles(['xlsx', 'csv'], '表格').catch(() => [] as string[]); if (p) void open(p); };

  // 费率改了以后重新计算
  const view = useMemo(() => {
    if (!batch) return null;
    return { ...batch, rows: batch.rows.map((r) => {
      const s = sites.find((x) => x.id === r.siteId);
      if (!s || (r.error && !r.error.startsWith(NO_RATE))) return r;
      if (needsRate(s)) return { ...r, result: undefined, error: `${NO_RATE}：${s.name}站，请先到「费率设置」填写` };
      return { ...r, error: undefined, result: calcProfit(r.input, s) };
    }) };
  }, [batch, sites]);

  const doTemplate = async () => {
    if (!ctx) return;
    try {
      const path = await save({ defaultPath: '虾皮利润-批量模板.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
      if (!path) return;
      await ctx.writeFile(path, await templateBytes());
      setNote({ kind: 'ok', text: `模板已保存：${path}`, path });
    } catch (e) { setNote({ kind: 'err', text: `保存失败：${errText(e)}` }); }
  };
  const doExport = async () => {
    if (!ctx || !view) return;
    setBusy(true);
    try {
      const path = await save({ defaultPath: exportName(view), filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
      if (path) setNote({ kind: 'ok', text: `已导出：${await exportBatch(ctx, view, sites, path)}`, path });
    } catch (e) { setNote({ kind: 'err', text: `导出失败：${errText(e)}` }); }
    setBusy(false);
  };

  if (!view) {
    return (
      <div className="sp-batch-empty">
        <button className={`k-drop big${hover ? ' hover' : ''}`} disabled={busy} onClick={pick}>
          <FileSpreadsheet size={26} />
          <span><b>把 Excel / CSV 拖到这里</b>，或点击选择<br /><small>每行一个商品，至少要有「售价」「采购成本」「重量」三列；站点列为空时按当前选择的站点计算</small></span>
        </button>
        <div className="k-actions"><button className="k-btn" onClick={doTemplate}><Download size={15} />下载批量模板</button></div>
        {note && <NoteBar n={note} onClose={() => setNote(null)} />}
      </div>
    );
  }

  const sum = batchSummary(view.rows);
  return (
    <div className="sp-batch">
      <div className="sp-batch-bar">
        <span className="sp-file k-ellipsis" title={view.path}><FileSpreadsheet size={15} />{view.name}</span>
        <span className="k-muted k-num">共 {sum.total} 个 · 算出 {sum.ok} 个{sum.err ? ` · 有问题 ${sum.err} 个` : ''}{sum.loss ? ` · 亏损 ${sum.loss} 个` : ''} · 平均利润率 {percent(sum.avgMargin)}</span>
        <span className="sp-sp" />
        <button className="k-btn" disabled={busy} onClick={pick}>换一个文件</button>
        <button className="k-btn primary" disabled={busy || preview} onClick={doExport}><Download size={15} />导出结果 Excel</button>
      </div>
      {note && <NoteBar n={note} onClose={() => setNote(null)} />}
      <div className="k-panel sp-table-wrap k-scroll">
        <table className="k-table">
          <thead><tr><th>行</th><th>SKU</th><th>商品</th><th>站点</th><th className="sp-r">售价</th><th className="sp-r">回款(元)</th><th className="sp-r">成本(元)</th><th className="sp-r">利润(元)</th><th className="sp-r">利润率</th><th className="sp-r">保本售价</th></tr></thead>
          <tbody>
            {view.rows.slice(0, SHOW_ROWS).map((r) => {
              const s = sites.find((x) => x.id === r.siteId);
              const x = r.result;
              return (
                <tr key={r.line}>
                  <td className="k-num k-muted">{r.line}</td>
                  <td className="k-num">{r.sku}</td>
                  <td className="sp-name">{r.name}</td>
                  <td>{s?.name ?? '-'}</td>
                  {x && s ? <>
                    <td className="k-num sp-r">{money(r.input.price, s.decimals)} <small className="k-muted">{s.currency}</small></td>
                    <td className="k-num sp-r">{money(x.netCny, 2)}</td>
                    <td className="k-num sp-r">{money(x.costCny, 2)}</td>
                    <td className={`k-num sp-r${x.profit < 0 ? ' neg' : ''}`}>{money(x.profit, 2)}</td>
                    <td className={`k-num sp-r${x.profit < 0 ? ' neg' : ''}`}>{percent(x.margin)}</td>
                    <td className="k-num sp-r">{x.breakeven == null ? '无法保本' : money(x.breakeven, s.decimals)}</td>
                  </> : <td colSpan={6} className="k-err-text">{r.error}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        {view.rows.length > SHOW_ROWS && <p className="k-muted sp-foot">这里只显示前 {SHOW_ROWS} 行，导出的 Excel 包含全部 {view.rows.length} 行</p>}
      </div>
    </div>
  );
}

function NoteBar({ n, onClose }: { n: Note; onClose: () => void }) {
  return (
    <div className={`k-notice ${n.kind}`} role={n.kind === 'err' ? 'alert' : 'status'}>
      <span>{n.text}</span>
      {n.path && <button className="k-link" onClick={() => reveal(n.path!)}><FolderOpen size={14} />在文件夹中显示</button>}
      <button className="k-icon-btn" aria-label="关闭提示" onClick={onClose}><X size={14} /></button>
    </div>
  );
}

// ---------------- 费率设置 ----------------

const RATE_COLS: [keyof SiteConfig, string, number][] = [
  ['rate', '汇率（1 当地币 = ? 元）', 0.00001], ['commission', '佣金 %', 0.1], ['transaction', '交易手续费 %', 0.1], ['service', '服务费 %', 0.1], ['payout', '提现 %', 0.1],
  ['firstWeight', '首重 克', 1], ['firstFee', '首重费', 0.01], ['stepWeight', '续重单位 克', 1], ['stepFee', '续重费', 0.01],
];

function RatesTab({ sites, update }: { sites: SiteConfig[]; update: (fn: (s: SiteConfig[]) => SiteConfig[]) => void }) {
  const set = (id: string, k: keyof SiteConfig, v: number) => update((all) => all.map((s) => (s.id === id ? { ...s, [k]: v } : s)));
  return (
    <div className="sp-rates">
      <div className="sp-banner" role="note">
        <TriangleAlert size={16} />
        <span><b>这里的数字都要你自己填，工具没有预置任何官方费率。</b>Shopee 各站点、各类目、是否参加免运或返现计划，佣金和手续费都不同，而且会调整。请登录 Shopee 卖家中心，按官方最新信息和当天汇率填写；填写后自动保存在这台电脑上，只在本机使用。{IS_PREVIEW && '（当前是预览页，表中为演示数字，非官方。）'}</span>
      </div>
      <div className="k-panel sp-table-wrap k-scroll">
        <table className="k-table sp-rate-table">
          <thead><tr><th>站点</th>{RATE_COLS.map(([k, l]) => <th key={k}>{l}</th>)}<th /></tr></thead>
          <tbody>
            {sites.map((s) => {
              const bad = needsRate(s) ? [] : checkSite(s);
              return (
                <tr key={s.id}>
                  <td><b>{s.name}</b> <small className="k-muted">{s.currency}</small>{needsRate(s) && <div className="k-muted sp-bad">未填写</div>}{bad.length > 0 && <div className="k-err-text sp-bad">{bad.join('；')}</div>}</td>
                  {RATE_COLS.map(([k, l, step]) => (
                    <td key={k}><input className="k-input sp-cell" type="number" step={step} min={0} aria-label={`${s.name} ${l}`} value={s[k] as number} onChange={(e) => set(s.id, k, e.target.value === '' ? 0 : Number(e.target.value))} /></td>
                  ))}
                  <td><button className="k-icon-btn" title="清空这一站的数字" aria-label={`清空${s.name}的数字`} onClick={() => update((all) => all.map((x) => (x.id === s.id ? DEFAULT_SITES.find((d) => d.id === s.id)! : x)))}><RotateCcw size={14} /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="k-muted sp-foot"><Calculator size={13} /> 计算口径：佣金、服务费按售价计；交易手续费按「售价 + 买家支付的运费」计；提现手续费按平台结算金额计；跨境物流费 = 首重费 + 超出首重的部分按续重单位向上取整 × 续重费。口径与你的实际账单不同时，可以把差额折算进对应费率。</p>
    </div>
  );
}

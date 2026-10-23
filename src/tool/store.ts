// 本机保存：站点费率模板和上次填写的单品数据（只存在这台电脑的 settings.json）。
import { settingsStore } from '../kit/platform';
import { mergeSites, type ItemInput, type SiteConfig } from './core';

const KEY_SITES = 'shopee.sites';
const KEY_LAST = 'shopee.last';

export interface LastInput {
  siteId: string;
  input: ItemInput;
  target: number;
}

export async function loadSites(): Promise<SiteConfig[] | null> {
  try {
    const st = await settingsStore();
    const v = await st.get<unknown>(KEY_SITES);
    return v ? mergeSites(v) : null;
  } catch {
    return null; // 浏览器预览没有本机存储
  }
}

export async function saveSites(sites: SiteConfig[]) {
  try {
    await (await settingsStore()).set(KEY_SITES, sites);
  } catch { /* 预览时忽略 */ }
}

export async function loadLast(): Promise<LastInput | null> {
  try {
    return (await (await settingsStore()).get<LastInput>(KEY_LAST)) ?? null;
  } catch {
    return null;
  }
}

export async function saveLast(v: LastInput) {
  try {
    await (await settingsStore()).set(KEY_LAST, v);
  } catch { /* 预览时忽略 */ }
}

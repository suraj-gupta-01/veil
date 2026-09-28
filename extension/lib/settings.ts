export interface Settings { serverUrl: string }
const DEFAULTS: Settings = { serverUrl: 'http://localhost:8000' };

export async function getSettings(): Promise<Settings> {
  const s = await browser.storage.local.get('settings');
  return { ...DEFAULTS, ...((s.settings as Partial<Settings>) ?? {}) };
}

export async function setSettings(patch: Partial<Settings>) {
  const cur = await getSettings();
  await browser.storage.local.set({ settings: { ...cur, ...patch } });
}

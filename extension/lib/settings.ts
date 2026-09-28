export interface Settings {
  serverUrl: string;
  /** User-defined sensitive terms (employee IDs, project codenames), redacted as CUSTOM wherever they appear. */
  terms: string[];
  /** Paranoid mode: OCR the outgoing image and block if anything sensitive is still readable. */
  paranoid: boolean;
}
const DEFAULTS: Settings = { serverUrl: 'http://localhost:8000', terms: [], paranoid: false };

export async function getSettings(): Promise<Settings> {
  const s = await browser.storage.local.get('settings');
  return { ...DEFAULTS, ...((s.settings as Partial<Settings>) ?? {}) };
}

export async function setSettings(patch: Partial<Settings>) {
  const cur = await getSettings();
  await browser.storage.local.set({ settings: { ...cur, ...patch } });
}

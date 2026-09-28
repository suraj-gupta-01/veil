export const VRS_VERSION = '1.0';

export type TokenClass =
  | 'SECRET'
  | 'AADHAAR' | 'PAN' | 'PASSPORT' | 'VOTER_ID'
  | 'CARD' | 'ACCOUNT' | 'IFSC' | 'UPI'
  | 'EMAIL' | 'PHONE' | 'ADDRESS' | 'USERNAME'
  | 'NAME' | 'DOB'
  | 'FACE' | 'SIGNATURE' | 'QR' | 'IMAGE'
  | 'CUSTOM';

export type ClassGroup =
  | 'SECRET' | 'GOV_ID' | 'FINANCIAL' | 'CONTACT' | 'PERSON'
  | 'BIOMETRIC' | 'ENCODED' | 'RASTER' | 'CUSTOM';

export const GROUP: Record<TokenClass, ClassGroup> = {
  SECRET: 'SECRET',
  AADHAAR: 'GOV_ID', PAN: 'GOV_ID', PASSPORT: 'GOV_ID', VOTER_ID: 'GOV_ID',
  CARD: 'FINANCIAL', ACCOUNT: 'FINANCIAL', IFSC: 'FINANCIAL', UPI: 'FINANCIAL',
  EMAIL: 'CONTACT', PHONE: 'CONTACT', ADDRESS: 'CONTACT', USERNAME: 'CONTACT',
  NAME: 'PERSON', DOB: 'PERSON',
  FACE: 'BIOMETRIC', SIGNATURE: 'BIOMETRIC', QR: 'ENCODED', IMAGE: 'RASTER',
  CUSTOM: 'CUSTOM',
};

export const TOKEN_RE = /⟦([A-Z_]+?)_(\d+)⟧/g;
export const makeToken = (cls: TokenClass, n: number) => `⟦${cls}_${n}⟧`;
export const tokensIn = (s: string) => [...s.matchAll(TOKEN_RE)].map((m) => m[0]);

export type BBox = [number, number, number, number];
export type Role =
  | 'textbox' | 'password' | 'checkbox' | 'radio' | 'combobox'
  | 'button' | 'link' | 'image' | 'other';

export interface VElement {
  id: number;
  role: Role;
  label: string;
  value?: string;
  placeholder?: string;
  field_class?: TokenClass;
  required?: boolean;
  disabled?: boolean;
  checked?: boolean;
  options?: string[];
  masked?: boolean;
  bbox: BBox;
  src: 'dom' | 'vision';
}

export interface VText { id: number; text: string; bbox: BBox }

export interface VEntity {
  token: string;
  class: TokenClass;
  group: ClassGroup;
  format?: string;
  valid_checksum?: boolean;
  source?: string;
}

export interface VScreen {
  origin: string;
  path_template: string;
  title: string;
  state: { class: string; confidence: number; src: 'heuristic' | 'vit' };
  viewport: [number, number];
  image?: string;
  elements: VElement[];
  texts: VText[];
}

export interface StepRequest {
  session_id: string;
  vrs_version: string;
  goal: string;
  step: number;
  mode: 'pixel' | 'structure';
  screen: VScreen;
  entities: VEntity[];
  history: { step: number; summary: string }[];
}

export type Action =
  | { type: 'click'; target: number; requires_confirmation?: boolean }
  | { type: 'type'; target: number; text: string }
  | { type: 'select'; target: number; option: string }
  | { type: 'scroll'; direction: 'up' | 'down'; amount?: number }
  | { type: 'key'; key: string; target?: number }
  | { type: 'wait'; ms: number }
  | { type: 'ask_user'; message: string; target?: number }
  | { type: 'done'; message?: string };

export interface StepResponse { actions: Action[]; rationale: string; done: boolean }
export interface SessionResponse { session_id: string; token: string; vrs_version: string; max_steps: number }

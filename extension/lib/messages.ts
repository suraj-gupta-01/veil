import type { Action, BBox, Role, StepRequest } from './vrs';
import type { Span } from './pii/rules';

export interface RawElement {
  vid: number;
  role: Role;
  tag: string;
  type: string;
  label: string;
  value: string;
  hasValue: boolean;
  placeholder: string;
  name: string;
  idAttr: string;
  autocomplete: string;
  required: boolean;
  disabled: boolean;
  checked?: boolean;
  options?: string[];
  bbox: BBox;
  valueBox: BBox;
}

export interface RawText { vid: number; text: string; bbox: BBox; spans: (Span & { rects: BBox[] })[] }
/** For iframes, `src` and `inner` (the content box) let the background match the frame's own snapshot. Local only. */
export interface RawRaster { vid: number; kind: string; alt: string; bbox: BBox; src?: string; inner?: BBox }

export interface RawSnapshot {
  url: string;
  title: string;
  viewport: [number, number];
  dpr: number;
  elements: RawElement[];
  texts: RawText[];
  rasters: RawRaster[];
  ms: number;
}

/** `field`: the box is a form field, whose width says nothing about the value, so it is not width-bucketed. */
export interface Mask { bbox: BBox; label: string; field?: boolean }
export interface Mark { id: number; bbox: BBox }

export interface CompositeRequest {
  image: string;
  viewport: [number, number];
  masks: Mask[];
  marks: Mark[];
  maxSide: number;
}

export interface CompositeResult {
  image: string;
  width: number;
  height: number;
  bytes: number;
  integrity: boolean;
  failed: number;
}

export type Timings = Record<string, number>;

export interface FirewallCheck { name: string; ok: boolean; detail?: string }
export interface FirewallResult { ok: boolean; checks: FirewallCheck[] }

export type ExecAction = Action;
export interface ExecResult { ok: boolean; error?: string }

export type PanelEvent =
  | { kind: 'status'; running: boolean; text: string }
  | { kind: 'log'; level: 'info' | 'warn' | 'error' | 'ok'; text: string }
  | {
      kind: 'lens';
      step: number;
      rawImage: string;
      sentImage?: string;
      payload: Omit<StepRequest, 'screen'> & { screen: Omit<StepRequest['screen'], 'image'> };
      tokens: { token: string; cls: string }[];
      timings: Timings;
      firewall: FirewallResult;
      bytes: number;
    }
  | { kind: 'approval'; id: string; title: string; detail: string; approve: string; reject: string }
  | { kind: 'approval-closed'; id: string };

export type PanelRequest =
  | { target: 'bg'; kind: 'scan' }
  | { target: 'bg'; kind: 'start'; goal: string; review: boolean; structureOnly: boolean }
  | { target: 'bg'; kind: 'stop' }
  | { target: 'bg'; kind: 'approve'; id: string; ok: boolean }
  | { target: 'bg'; kind: 'reveal'; token: string }
  | { target: 'bg'; kind: 'wipe' };

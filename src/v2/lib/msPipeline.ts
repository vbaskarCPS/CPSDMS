// src/v2/lib/msPipeline.ts — MainstreetAI pipeline: each business's stage (worked out from what's happened),
// how hot it is (with the reasons), and its whole history. Database: 20261246300000_mainstreet_pipeline.sql.
import { db, must } from './client';

/** Four stages, New → Pitched → Booked → Won; Lost is the off-ramp (Not interested, Not a fit). */
export type Stage = 'new' | 'pitched' | 'questionnaire' | 'booked' | 'won' | 'lost';
export type Heat = 'hot' | 'warm' | 'cold';
export const STAGES: { key: Stage; label: string }[] = [
  { key: 'new', label: 'New' }, { key: 'pitched', label: 'Pitched' }, { key: 'questionnaire', label: 'Questionnaire' },
  { key: 'booked', label: 'Onboarding booked' }, { key: 'won', label: 'Won' }, { key: 'lost', label: 'Lost' },
];
export const stageLabel = (s: string | undefined) => STAGES.find(x => x.key === s)?.label || s || '';
export const HEAT: Record<Heat, { label: string; tone: 'r' | 'a' | 'b' }> = { hot: { label: 'Hot', tone: 'r' }, warm: { label: 'Warm', tone: 'a' }, cold: { label: 'Cold', tone: 'b' } };
export const LOST_REASONS = ['Happy with their accountant', 'Not incorporated', 'Too small', 'Price', 'Not the right time', 'Under contract', 'Other'];

export interface BizState {
  stage: Stage; heat?: Heat; points: number; why?: string[]; lost_reason?: string;
  meeting?: { id: string; starts_at: string; status: string; host: string }; yearly?: number; decider?: string; last_at?: string; visits: number;
}
export interface PipeRow extends BizState {
  id: string; campaign_id: string; name: string; address: string | null; kind: string; campaign: string; color: string;
  zone: string | null; rep_id: string | null; rep: string | null; lat?: number | null; lng?: number | null;
}
export interface TimelineItem { at: string; kind: string; title?: string; outcome?: string; by?: string; text?: string; who?: string; far?: boolean; follow_up_at?: string }

export async function businessState(business: string, campaign: string): Promise<BizState> {
  return must(await db.rpc('ms_business_state', { p_business: business, p_campaign: campaign })) as BizState;
}
/** The rep presented the deck: the business is Pitched from now on. */
export async function markPitched(business: string, campaign: string): Promise<BizState> {
  return must(await db.rpc('ms_mark_pitched', { p_business: business, p_campaign: campaign })) as BizState;
}
export async function setLost(business: string, campaign: string, reason: string | null): Promise<BizState> {
  return must(await db.rpc('ms_set_lost', { p_business: business, p_campaign: campaign, p_reason: reason })) as BizState;
}
export async function pipeline(campaign?: string | null, rep?: string | null): Promise<PipeRow[]> {
  return (must(await db.rpc('ms_pipeline', { p_campaign: campaign || null, p_rep: rep || null })) as PipeRow[]) || [];
}
export async function timeline(business: string, campaign: string): Promise<TimelineItem[]> {
  return (must(await db.rpc('ms_business_timeline', { p_business: business, p_campaign: campaign })) as TimelineItem[]) || [];
}

/** Rows by stage, in the board's order. */
export function byStage(rows: PipeRow[]): Record<Stage, PipeRow[]> {
  const out = { new: [], pitched: [], questionnaire: [], booked: [], won: [], lost: [] } as Record<Stage, PipeRow[]>;
  for (const r of rows) (out[r.stage] || out.new).push(r);
  return out;
}

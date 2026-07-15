// src/lib/reportingService.ts
import { supabase } from './supabase';
import { Region, SeasonType } from '../types';

// ============================================================================
// REPORTING SERVICE — Payable City Sales
// ----------------------------------------------------------------------------
// Backs the super-admin Reporting area. Two config record types:
//   1. Workbook configs  — which Google Sheets to read Payout Stats from, and
//      how their date ranges map to region / season / tax / product-cost.
//   2. Payable cities    — prefix ownership + per-region payout share tables.
//
// Storage: two Supabase tables (report_workbook_configs, report_payable_cities).
// Top-level columns are snake_case and hand-mapped here. Everything inside the
// jsonb columns (date_ranges, prefixes, region_splits) is camelCase both ways —
// the Supabase client does no key transform, so what we write is what we read.
// ============================================================================

// --- TYPES: WORKBOOK CONFIG ---

/**
 * One date range within a workbook. A range is an inclusive span of MmmDD tabs
 * (e.g. May07 → Jun15) tagged with the region/season it represents plus the
 * manually-entered tax and product-cost rates used to compute payable sales.
 *
 * taxRate and productCostPercent are whole-number percentages (13 = 13%, not 0.13).
 */
export interface WorkbookDateRange {
  startTab: string;          // e.g. "May07"
  endTab: string;            // e.g. "Jun15"
  region: Region;
  season: SeasonType;
  taxRate: number;           // percent, e.g. 13
  productCostPercent: number; // percent, e.g. 20
  nickname?: string;         // optional label for this range, e.g. "Q2 Aeration"
}

export interface WorkbookConfig {
  id: string;
  label: string;             // human label, e.g. "CEO Workerbook"
  sheetId: string;           // Google Sheet ID (extracted from URL at save time)
  dateRanges: WorkbookDateRange[];
  createdAt?: string;
  updatedAt?: string;
}

// --- TYPES: PAYABLE CITY ---

/**
 * A single share entry: when a selling city's worker sells in a given region,
 * `city` receives `percent` of the payable sales. Shares for one region must
 * sum to 100.
 */
export interface CitySplitShare {
  city: string;              // receiving city NAME (references PayableCity.name)
  percent: number;           // 0-100
}

/**
 * Per-region split table for ONE selling city. Keyed by region. A region absent
 * from the map means this city has no sales attributed for that region (treated
 * as unconfigured — surfaced as unattributed at report time, not silently split).
 */
export type RegionSplits = Partial<Record<Region, CitySplitShare[]>>;

// --- TYPES: CONTRACTOR OVERRIDES (data cleanup) ---

/** Two contractor IDs (or split base-keys) that are the same person. */
export interface MergeOverridePayload {
  members: string[];       // identity base-keys merged into one person
  canonicalName: string;   // display name for the merged person
}

/** One contractor ID that is actually several people; split by name. */
export interface SplitOverridePayload {
  id: string;              // contractor ID whose rows split apart by full name
}

export type ContractorOverrideKind = 'merge' | 'split';

export interface ContractorOverride {
  id: string;
  kind: ContractorOverrideKind;
  payload: MergeOverridePayload | SplitOverridePayload;
  createdAt: string;
}

export interface PayableCity {
  id: string;
  name: string;              // e.g. "Hamilton"
  prefixes: string[];        // e.g. ["H"] or ["E", "EDM"]
  regionSplits: RegionSplits;
  createdAt?: string;
  updatedAt?: string;
}

// --- VALIDATION HELPERS (pure) ---

/**
 * True if a single region's shares sum to 100 (within floating-point tolerance).
 * Used by the city modal to gate saving. An empty list is NOT valid — an
 * unconfigured region should be left absent, not saved as an empty split.
 */
export const validateRegionSplitTotal = (shares: CitySplitShare[]): boolean => {
  if (!shares || shares.length === 0) return false;
  const total = shares.reduce((sum, s) => sum + (Number(s.percent) || 0), 0);
  return Math.abs(total - 100) < 0.01;
};

/**
 * Extract the leading-letters prefix from a contractor ID.
 * "H1001" → "H", "EDM204" → "EDM", "C1012" → "C". Returns "" if none.
 * Case-preserving; matching against city prefixes is done by the caller.
 */
export const extractContractorPrefix = (contractorId: string): string => {
  if (!contractorId) return '';
  const m = contractorId.trim().match(/^([A-Za-z]+)/);
  return m ? m[1] : '';
};

class ReportingService {
  private static instance: ReportingService;
  private constructor() {}

  public static getInstance(): ReportingService {
    if (!ReportingService.instance) {
      ReportingService.instance = new ReportingService();
    }
    return ReportingService.instance;
  }

  // ==========================================================================
  // WORKBOOK CONFIGS
  // ==========================================================================

  public async getWorkbookConfigs(): Promise<WorkbookConfig[]> {
    const { data, error } = await supabase
      .from('report_workbook_configs')
      .select('*')
      .order('created_at', { ascending: true });

    if (error || !data) return [];
    return data.map(this.mapDbToWorkbookConfig);
  }

  public async createWorkbookConfig(cfg: {
    label: string;
    sheetId: string;
    dateRanges?: WorkbookDateRange[];
  }): Promise<WorkbookConfig> {
    const { data, error } = await supabase
      .from('report_workbook_configs')
      .insert({
        label: cfg.label,
        sheet_id: cfg.sheetId,
        date_ranges: cfg.dateRanges || [],
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return this.mapDbToWorkbookConfig(data);
  }

  public async updateWorkbookConfig(
    id: string,
    updates: Partial<{ label: string; sheetId: string; dateRanges: WorkbookDateRange[] }>
  ): Promise<WorkbookConfig> {
    const dbUpdates: any = { updated_at: new Date().toISOString() };
    if (updates.label !== undefined) dbUpdates.label = updates.label;
    if (updates.sheetId !== undefined) dbUpdates.sheet_id = updates.sheetId;
    if (updates.dateRanges !== undefined) dbUpdates.date_ranges = updates.dateRanges;

    const { data, error } = await supabase
      .from('report_workbook_configs')
      .update(dbUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return this.mapDbToWorkbookConfig(data);
  }

  public async deleteWorkbookConfig(id: string): Promise<void> {
    const { error } = await supabase
      .from('report_workbook_configs')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  // ==========================================================================
  // PAYABLE CITIES
  // ==========================================================================

  public async getPayableCities(): Promise<PayableCity[]> {
    const { data, error } = await supabase
      .from('report_payable_cities')
      .select('*')
      .order('created_at', { ascending: true });

    if (error || !data) return [];
    return data.map(this.mapDbToPayableCity);
  }

  public async createPayableCity(city: {
    name: string;
    prefixes?: string[];
    regionSplits?: RegionSplits;
  }): Promise<PayableCity> {
    const { data, error } = await supabase
      .from('report_payable_cities')
      .insert({
        name: city.name,
        prefixes: city.prefixes || [],
        region_splits: city.regionSplits || {},
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return this.mapDbToPayableCity(data);
  }

  public async updatePayableCity(
    id: string,
    updates: Partial<{ name: string; prefixes: string[]; regionSplits: RegionSplits }>
  ): Promise<PayableCity> {
    const dbUpdates: any = { updated_at: new Date().toISOString() };
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.prefixes !== undefined) dbUpdates.prefixes = updates.prefixes;
    if (updates.regionSplits !== undefined) dbUpdates.region_splits = updates.regionSplits;

    const { data, error } = await supabase
      .from('report_payable_cities')
      .update(dbUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return this.mapDbToPayableCity(data);
  }

  public async deletePayableCity(id: string): Promise<void> {
    const { error } = await supabase
      .from('report_payable_cities')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  // ==========================================================================
  // CONTRACTOR OVERRIDES (data cleanup)
  // ==========================================================================

  public async getContractorOverrides(): Promise<ContractorOverride[]> {
    const { data, error } = await supabase
      .from('report_contractor_overrides')
      .select('*')
      .order('created_at', { ascending: true });

    if (error || !data) return [];
    return data.map(this.mapDbToOverride);
  }

  public async createContractorOverride(o: {
    kind: ContractorOverrideKind;
    payload: MergeOverridePayload | SplitOverridePayload;
  }): Promise<ContractorOverride> {
    const { data, error } = await supabase
      .from('report_contractor_overrides')
      .insert({ kind: o.kind, payload: o.payload })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return this.mapDbToOverride(data);
  }

  public async deleteContractorOverride(id: string): Promise<void> {
    const { error } = await supabase
      .from('report_contractor_overrides')
      .delete()
      .eq('id', id);

    if (error) throw new Error(error.message);
  }

  // ==========================================================================
  // MAPPERS
  // ==========================================================================

  private mapDbToWorkbookConfig(data: any): WorkbookConfig {
    return {
      id: data.id,
      label: data.label,
      sheetId: data.sheet_id,
      dateRanges: Array.isArray(data.date_ranges) ? data.date_ranges : [],
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  private mapDbToPayableCity(data: any): PayableCity {
    return {
      id: data.id,
      name: data.name,
      prefixes: Array.isArray(data.prefixes) ? data.prefixes : [],
      regionSplits: (data.region_splits && typeof data.region_splits === 'object')
        ? data.region_splits
        : {},
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
  private mapDbToOverride(data: any): ContractorOverride {
    return {
      id: data.id,
      kind: data.kind,
      payload: (data.payload && typeof data.payload === 'object') ? data.payload : {},
      createdAt: data.created_at,
    };
  }
}

export const reportingService = ReportingService.getInstance();
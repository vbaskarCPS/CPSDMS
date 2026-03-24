// src/lib/routeFinder/rfPrefixService.ts
//
// CRUD for rf_prefix_mappings table.
// Stores the discovered call book prefix + optional city filter → map prefix mappings.
// Global per region (East/Central/West).
//

import { supabase } from '../supabase';

export interface RFPrefixMapping {
  id: string;
  region: string;
  callBookPrefix: string;
  cityFilter: string | null;
  mapPrefix: string;
  createdAt: string;
  updatedAt: string;
}

function mapRow(row: any): RFPrefixMapping {
  return {
    id:              row.id,
    region:          row.region,
    callBookPrefix:  row.call_book_prefix,
    cityFilter:      row.city_filter ?? null,
    mapPrefix:       row.map_prefix,
    createdAt:       row.created_at,
    updatedAt:       row.updated_at,
  };
}

export const rfPrefixService = {

  // Load all mappings for a region
  async loadMappings(region: string): Promise<RFPrefixMapping[]> {
    const { data, error } = await supabase
      .from('rf_prefix_mappings')
      .select('*')
      .eq('region', region)
      .order('call_book_prefix');

    if (error) throw new Error('Failed to load prefix mappings: ' + error.message);
    return (data || []).map(mapRow);
  },

  // Resolve a call book prefix + city to a map prefix
  // Tries city-specific match first, then falls back to null city_filter
  resolveMapPrefix(
    callBookPrefix: string,
    city: string,
    mappings: RFPrefixMapping[]
  ): string | null {
    const upper = callBookPrefix.toUpperCase();
    const lowerCity = city.trim().toLowerCase();

    // Try city-specific match first
    const cityMatch = mappings.find(m =>
      m.callBookPrefix.toUpperCase() === upper &&
      m.cityFilter !== null &&
      lowerCity.includes(m.cityFilter.toLowerCase())
    );
    if (cityMatch) return cityMatch.mapPrefix;

    // Fall back to null city_filter (matches all cities)
    const genericMatch = mappings.find(m =>
      m.callBookPrefix.toUpperCase() === upper &&
      m.cityFilter === null
    );
    return genericMatch?.mapPrefix ?? null;
  },

  // Save a discovered mapping (upsert)
  async saveMapping(params: {
    region: string;
    callBookPrefix: string;
    cityFilter: string | null;
    mapPrefix: string;
  }): Promise<RFPrefixMapping> {
    const { region, callBookPrefix, cityFilter, mapPrefix } = params;

    const { data, error } = await supabase
      .from('rf_prefix_mappings')
      .upsert({
        region,
        call_book_prefix: callBookPrefix.toUpperCase(),
        city_filter:      cityFilter || null,
        map_prefix:       mapPrefix.toUpperCase(),
        updated_at:       new Date().toISOString(),
      }, {
        onConflict: 'region,call_book_prefix,city_filter',
      })
      .select()
      .single();

    if (error) throw new Error('Failed to save prefix mapping: ' + error.message);
    return mapRow(data);
  },

  // Save multiple mappings at once
  async saveMappings(mappings: {
    region: string;
    callBookPrefix: string;
    cityFilter: string | null;
    mapPrefix: string;
  }[]): Promise<void> {
    if (mappings.length === 0) return;

    const rows = mappings.map(m => ({
      region:           m.region,
      call_book_prefix: m.callBookPrefix.toUpperCase(),
      city_filter:      m.cityFilter || null,
      map_prefix:       m.mapPrefix.toUpperCase(),
      updated_at:       new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('rf_prefix_mappings')
      .upsert(rows, { onConflict: 'region,call_book_prefix,city_filter' });

    if (error) throw new Error('Failed to save prefix mappings: ' + error.message);
  },

  // Delete a mapping
  async deleteMapping(id: string): Promise<void> {
    const { error } = await supabase
      .from('rf_prefix_mappings')
      .delete()
      .eq('id', id);

    if (error) throw new Error('Failed to delete prefix mapping: ' + error.message);
  },
};
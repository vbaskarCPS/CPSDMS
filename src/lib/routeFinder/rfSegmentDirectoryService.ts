// src/lib/routeFinder/rfSegmentDirectoryService.ts
//
// Manages adding street names to the route_maps segments JSONB array.
// When a red pin is confirmed and the street name isn't in the route's segments,
// we add a name-only entry (with midpoint coordinates if available) so future
// fuzzy matching can find it without Mapbox.
//
// Also handles cascade re-matching: after adding a segment name, re-run
// fuzzy matching against all pending queue entries for that prefix to see
// if any can now be auto-resolved.
//

import { supabase } from '../supabase';
import { ApprovedRoute } from './routeFinderGeoService';

export interface SegmentEntry {
  osmId: number;
  name: string;
  coordinates: [number, number][]; // [lng, lat] pairs — may be just midpoint
}

export const rfSegmentDirectoryService = {

  // Add a street name to a route's segments array
  // If midpoint coords are known (from Pass 3), include them
  // Returns the updated route or null if route not found
  async addSegmentName(params: {
    routeCode: string;
    segmentName: string;
    midpointLat?: number;
    midpointLng?: number;
  }): Promise<boolean> {
    const { routeCode, segmentName, midpointLat, midpointLng } = params;

    // Load the route
    const { data: routes, error: loadError } = await supabase
      .from('route_maps')
      .select('id, segments')
      .eq('route_code', routeCode.toUpperCase())
      .eq('status', 'approved');

    if (loadError || !routes || routes.length === 0) {
      console.warn(`RF: route ${routeCode} not found for segment addition`);
      return false;
    }

    const route = routes[0];
    const segments: SegmentEntry[] = route.segments || [];

    // Check if this name already exists (case-insensitive)
    const alreadyExists = segments.some(
      s => s.name.toLowerCase() === segmentName.toLowerCase()
    );
    if (alreadyExists) return true; // already there, no-op

    // Build new segment entry
    const newSegment: SegmentEntry = {
      osmId: Date.now(), // synthetic ID for directory-added segments
      name:  segmentName,
      coordinates: midpointLat !== undefined && midpointLng !== undefined
        ? [[midpointLng, midpointLat]]  // single midpoint coordinate
        : [],
    };

    const updatedSegments = [...segments, newSegment];

    const { error: updateError } = await supabase
      .from('route_maps')
      .update({
        segments:   updatedSegments,
        updated_at: new Date().toISOString(),
      })
      .eq('id', route.id);

    if (updateError) {
      console.error('RF: error adding segment name:', updateError);
      return false;
    }

    return true;
  },

  // Check if a segment name already exists in any route with the given prefix
  segmentNameExists(
    segmentName: string,
    mapPrefix: string,
    routes: ApprovedRoute[]
  ): boolean {
    const upper = mapPrefix.toUpperCase();
    const lower = segmentName.toLowerCase();

    for (const route of routes) {
      const routePrefix = route.route_code.match(/^([a-zA-Z]+)/)?.[1]?.toUpperCase();
      if (routePrefix !== upper) continue;
      if (!route.segments) continue;
      for (const seg of route.segments) {
        if (seg.name.toLowerCase() === lower) return true;
      }
    }
    return false;
  },

  // Reload approved routes after a segment addition (to pick up the new name)
  async reloadRoutes(): Promise<ApprovedRoute[]> {
    const { data, error } = await supabase
      .from('route_maps')
      .select('*')
      .eq('status', 'approved');

    if (error) throw new Error('Failed to reload routes: ' + error.message);
    return (data || []) as ApprovedRoute[];
  },
};
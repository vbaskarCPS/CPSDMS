// src/lib/shuttleRosterService.ts
import { supabase } from './supabase';

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface ShuttleRosterEntry {
  id: string;
  commandCenterId: string;
  dateTab: string;
  contractorId: string;
  firstName: string;
  lastName: string;
  cellPhone: string;
  shuttleNumber: string;
  confirmed: boolean;
  showed: boolean;
  createdAt: string;
}

export interface PublicShuttlePoint {
  id: string;
  shuttleNumber: string;
  description: string;
  pickupTime: string;
  googleMapsUrl: string;
}

export interface CommandCenterPublic {
  id: string;
  displayName: string;
  username: string;
}

// ─── PUSH ROSTER (admin action — wipe + insert) ──────────────────────────────

export async function pushShuttleRoster(
  commandCenterId: string,
  dateTab: string,
  contractors: {
    contractorId: string;
    firstName: string;
    lastName: string;
    cellPhone: string;
    shuttleNumber: string;
    confirmed: boolean;
  }[],
): Promise<void> {
  // 1. Delete all existing rows for this CC + date
  const { error: deleteError } = await supabase
    .from('shuttle_day_roster')
    .delete()
    .eq('command_center_id', commandCenterId)
    .eq('date_tab', dateTab);

  if (deleteError) throw new Error(deleteError.message);

  if (contractors.length === 0) return;

  // 2. Insert fresh roster
  const rows = contractors.map(c => ({
    command_center_id: commandCenterId,
    date_tab: dateTab,
    contractor_id: c.contractorId,
    first_name: c.firstName,
    last_name: c.lastName,
    cell_phone: c.cellPhone,
    shuttle_number: c.shuttleNumber,
    confirmed: c.confirmed,
    showed: false,
  }));

  const { error: insertError } = await supabase
    .from('shuttle_day_roster')
    .insert(rows);

  if (insertError) throw new Error(insertError.message);
}

// ─── GET ROSTER ───────────────────────────────────────────────────────────────

export async function getShuttleRoster(
  commandCenterId: string,
  dateTab: string,
): Promise<ShuttleRosterEntry[]> {
  const { data, error } = await supabase
    .from('shuttle_day_roster')
    .select('*')
    .eq('command_center_id', commandCenterId)
    .eq('date_tab', dateTab)
    .order('last_name', { ascending: true });

  if (error) throw new Error(error.message);
  return (data || []).map(mapToRosterEntry);
}

// ─── GET LATEST DATE TAB ─────────────────────────────────────────────────────

export async function getLatestDateTab(
  commandCenterId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('shuttle_day_roster')
    .select('date_tab')
    .eq('command_center_id', commandCenterId)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);
  return data && data.length > 0 ? data[0].date_tab : null;
}

// ─── TOGGLE SHOWED ────────────────────────────────────────────────────────────

export async function toggleShowed(
  id: string,
  showed: boolean,
): Promise<void> {
  const { error } = await supabase
    .from('shuttle_day_roster')
    .update({ showed })
    .eq('id', id);

  if (error) throw new Error(error.message);
}

// ─── LOOKUP CC BY USERNAME (public, no auth) ─────────────────────────────────

export async function getCommandCenterByUsername(
  username: string,
): Promise<CommandCenterPublic | null> {
  const { data, error } = await supabase
    .from('command_centers')
    .select('id, display_name, username')
    .eq('username', username)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    displayName: data.display_name,
    username: data.username,
  };
}

// ─── GET SHUTTLE POINTS (public, no auth context needed) ──────────────────────

export async function getShuttlePointsPublic(
  commandCenterId: string,
): Promise<PublicShuttlePoint[]> {
  const { data, error } = await supabase
    .from('shuttle_points')
    .select('id, shuttle_number, description, pickup_time, google_maps_url')
    .eq('command_center_id', commandCenterId)
    .order('shuttle_number', { ascending: true });

  if (error) throw new Error(error.message);
  return (data || []).map(d => ({
    id: d.id,
    shuttleNumber: d.shuttle_number,
    description: d.description || '',
    pickupTime: d.pickup_time || '',
    googleMapsUrl: d.google_maps_url || '',
  }));
}

// ─── MAPPER ───────────────────────────────────────────────────────────────────

function mapToRosterEntry(data: any): ShuttleRosterEntry {
  return {
    id: data.id,
    commandCenterId: data.command_center_id,
    dateTab: data.date_tab,
    contractorId: data.contractor_id,
    firstName: data.first_name,
    lastName: data.last_name,
    cellPhone: data.cell_phone,
    shuttleNumber: data.shuttle_number,
    confirmed: data.confirmed,
    showed: data.showed,
    createdAt: data.created_at,
  };
}
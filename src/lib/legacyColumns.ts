// src/lib/legacyColumns.ts
// Password columns are hidden from the public app key. Every read of these
// tables names its columns instead of using '*', and logins go through the
// legacy_login_* database functions. Add new columns here (and grant them in
// a migration) when a table gains one.

export const USER_COLS = 'user_id, role, name, username, metadata, command_center_id';

export const CENTER_COLS =
  'id, username, display_name, region, workerbook_sheet_id, masterbookings_sheet_id, created_at, reply_to_email, ' +
  'logo_url, job_fairs_enabled, job_fairs_slug, digital_mapping_enabled, callbook_sheet_id, workerbook_run_url';

export const CAMPAIGN_MANAGER_COLS = 'id, campaign_id, name, rep_code, created_at, lifetime_badges';

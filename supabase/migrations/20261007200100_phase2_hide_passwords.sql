-- Phase 2 · security fixes, part B: hide the password columns from the public app key.
-- Run only AFTER the app code from the same pull request is deployed: older code
-- reads these tables with select('*'), which stops working once this runs.

-- Table-level SELECT is replaced by SELECT on every column except password.
-- Inserts, updates and deletes keep working as before.
-- A column added to one of these tables later must be granted here too.
revoke select on public.users, public.command_centers, public.campaign_managers from anon, authenticated;

grant select (user_id, role, name, username, metadata, command_center_id)
  on public.users to anon, authenticated;

grant select (id, username, display_name, region, workerbook_sheet_id, masterbookings_sheet_id, created_at,
              reply_to_email, logo_url, job_fairs_enabled, job_fairs_slug, digital_mapping_enabled,
              callbook_sheet_id, workerbook_run_url, services, cn_prefix, local_number, review_link,
              tax_name, tax_rate, is_active)
  on public.command_centers to anon, authenticated;

grant select (id, campaign_id, name, rep_code, created_at, lifetime_badges)
  on public.campaign_managers to anon, authenticated;

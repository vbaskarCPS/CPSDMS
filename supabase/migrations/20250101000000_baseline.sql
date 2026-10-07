-- Baseline: the public schema of project mipvcafqrmwxnoqmicxh as it stood on 2026-10-07,
-- captured from the live database before the CPSDMS refactor. Recorded in production as
-- already applied; replayed only on fresh databases (staging branches, local).
set check_function_bodies = off;

-- extensions
create extension if not exists http with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pg_stat_statements with schema extensions;
create extension if not exists supabase_vault with schema vault;
create extension if not exists postgis with schema public;


-- sequences
create sequence if not exists public.nar_addresses_id_seq as bigint start 1 increment 1;
create sequence if not exists public.route_houses_id_seq as bigint start 1 increment 1;
create sequence if not exists public.house_dispositions_id_seq as bigint start 1 increment 1;
create sequence if not exists public.building_footprints_id_seq as bigint start 1 increment 1;
create sequence if not exists public.city_address_points_id_seq as bigint start 1 increment 1;
create sequence if not exists public.route_street_lines_id_seq as bigint start 1 increment 1;


-- tables
create table if not exists public.area_prefixes (
  area_name text not null,
  prefix text not null,
  pdf_page integer,
  created_at timestamp with time zone default now(),
  region text,
  route_count integer,
  page_number integer,
  route_start integer default 1 not null
);

create table if not exists public.bambora_idempotency (
  idempotency_key text not null,
  status text default 'processing'::text not null,
  amount text,
  client_name text,
  response_data jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

create table if not exists public.bookings (
  booking_id text not null,
  command_center_id uuid not null,
  route_number text,
  status text default 'pending'::text,
  contractor_id text,
  price text,
  customer_details jsonb,
  log_notes text,
  is_prepaid boolean default false,
  session_date date,
  data jsonb,
  services jsonb default '{}'::jsonb,
  session_id text
);

create table if not exists public.building_footprints (
  id bigint default nextval('building_footprints_id_seq'::regclass) not null,
  wkt text not null
);

create table if not exists public.campaign_books (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  display_name text not null,
  spreadsheet_id text not null,
  spreadsheet_url text,
  apps_script_url text,
  campaign_type text default 'standard'::text not null,
  sniper_config jsonb,
  created_at timestamp with time zone default now(),
  master_spreadsheet_url text,
  master_spreadsheet_id text
);

create table if not exists public.campaign_managers (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  name text not null,
  rep_code text not null,
  password text default 'callofduty'::text not null,
  created_at timestamp with time zone default now(),
  lifetime_badges jsonb default '{}'::jsonb
);

create table if not exists public.campaigns (
  id uuid default gen_random_uuid() not null,
  display_name text not null,
  spreadsheet_id text not null,
  spreadsheet_url text,
  apps_script_url text,
  created_by text,
  created_at timestamp with time zone default now(),
  sniper_config jsonb default '{"years": [2025], "ppOnly": false, "hideCTS": true, "linkShot": false, "minEntries": 1}'::jsonb,
  campaign_type text default 'standard'::text not null
);

create table if not exists public.command_centers (
  id uuid default gen_random_uuid() not null,
  username text not null,
  password text not null,
  display_name text not null,
  region text default 'West'::text not null,
  workerbook_sheet_id text not null,
  masterbookings_sheet_id text not null,
  created_at timestamp with time zone default now(),
  reply_to_email text,
  logo_url text,
  job_fairs_enabled boolean default false,
  job_fairs_slug text,
  digital_mapping_enabled boolean default false,
  callbook_sheet_id text,
  workerbook_run_url text
);

create table if not exists public.contractors (
  id uuid default gen_random_uuid() not null,
  contractor_id text not null,
  first_name text not null,
  last_name text default ''::text not null,
  cell_phone text,
  command_center_id text not null,
  region text,
  created_at timestamp with time zone default now(),
  shuttle text,
  email text,
  first_day_booked text,
  onboarding_email_sent_at timestamp with time zone,
  level_2_unlocked_at timestamp with time zone,
  level_3_unlocked_at timestamp with time zone
);

create table if not exists public.cut_bookings (
  id uuid default gen_random_uuid() not null,
  book_id uuid not null,
  booking_id text not null,
  cut_at timestamp with time zone default now()
);

create table if not exists public.daily_sessions (
  date date not null,
  command_center_id uuid not null,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  import_meta jsonb default '{"source": "file", "sheetsExported": false}'::jsonb,
  season_type text default 'aeration'::text
);

create table if not exists public.dialer_presence (
  manager_id text not null,
  manager_name text not null,
  campaign_id text not null,
  last_seen timestamp with time zone default now() not null
);

create table if not exists public.dialer_sessions (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  manager_id uuid not null,
  session_date date default CURRENT_DATE not null,
  gamification_state jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.dialer_team_events (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  manager_id uuid not null,
  manager_name text not null,
  points integer default 0 not null,
  badges text[] default '{}'::text[],
  multipliers text[] default '{}'::text[],
  is_prepay boolean default false,
  created_at timestamp with time zone default now(),
  pp_dollars integer default 0,
  is_booking boolean default false,
  is_dial boolean default true,
  is_login boolean default false,
  is_multiplier boolean default false,
  multiplier_id text
);

create table if not exists public.email_logs (
  id uuid default gen_random_uuid() not null,
  transaction_id text,
  recipient_email text not null,
  email_type text not null,
  status text default 'sent'::text not null,
  bounce_reason text,
  sent_at timestamp with time zone default now(),
  bounced_at timestamp with time zone,
  resend_message_id text
);

create table if not exists public.email_templates (
  id uuid default gen_random_uuid() not null,
  command_center_id uuid not null,
  template_type text not null,
  template_name text not null,
  subject text not null,
  html_content text not null,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  content_structure jsonb
);

create table if not exists public.gallery_steps (
  id uuid default gen_random_uuid() not null,
  contractor_id text not null,
  title text not null,
  caption text,
  "position" integer default 0 not null,
  photos jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.geocode_cache (
  address_key text not null,
  command_center_id uuid not null,
  session_date date not null,
  lat double precision not null,
  lng double precision not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.house_dispositions (
  id bigint default nextval('house_dispositions_id_seq'::regclass) not null,
  route_code text not null,
  house_key text not null,
  status text not null,
  note text,
  command_center_id text,
  worker_id text,
  session_id text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  first_name text
);

create table if not exists public.job_fair_applicants (
  id uuid default gen_random_uuid() not null,
  session_id uuid not null,
  command_center_id uuid not null,
  first_name text not null,
  last_name text not null,
  cell_phone text not null,
  alternate_phone text,
  email text,
  address text not null,
  city text,
  postal_code text,
  age integer not null,
  id_type text not null,
  id_value text not null,
  rating integer,
  is_bc boolean default false,
  is_management boolean default false,
  is_interviewed boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  notes text
);

create table if not exists public.job_fair_sessions (
  id uuid default gen_random_uuid() not null,
  command_center_id uuid not null,
  session_date date default CURRENT_DATE not null,
  status text default 'active'::text not null,
  created_at timestamp with time zone default now(),
  closed_at timestamp with time zone
);

create table if not exists public.logsheet_sessions (
  id text not null,
  worker_id text,
  date date,
  command_center_id uuid not null,
  status text default 'OPEN'::text,
  stats jsonb default '{}'::jsonb,
  validation jsonb default '{}'::jsonb,
  bonuses jsonb default '[]'::jsonb,
  email_enabled boolean default true,
  team_worker_ids text[] default '{}'::text[],
  equiv_split jsonb default '{}'::jsonb,
  upsell_split jsonb default '{}'::jsonb,
  crackfiller_bottles integer default 0 not null
);

create table if not exists public.manager_locations (
  manager_id text not null,
  command_center_id uuid not null,
  lat double precision not null,
  lng double precision not null,
  heading double precision,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.map_logsheet_access (
  contractor_id text not null,
  note text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.map_logsheet_cc_access (
  command_center_id uuid not null,
  note text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.map_pcl_cache (
  route_code text not null,
  area_name text not null,
  region text,
  prefix text,
  clients jsonb default '[]'::jsonb not null,
  client_count integer default 0 not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.map_pins (
  id text not null,
  command_center_id text not null,
  session_date date not null,
  label text not null,
  lat double precision not null,
  lng double precision not null,
  created_by text,
  created_at timestamp with time zone default now() not null,
  visibility text default 'private'::text not null,
  target_manager_id text,
  target_worker_id text,
  stop_order integer
);

create table if not exists public.na_cooldown_log (
  id uuid default gen_random_uuid() not null,
  phone text not null,
  campaign_id uuid not null,
  rep_id uuid not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.nar_addresses (
  id bigint default nextval('nar_addresses_id_seq'::regclass) not null,
  loc_guid uuid,
  addr_guid uuid,
  civic_no integer,
  civic_suffix text,
  street_name text,
  street_type text,
  street_dir text,
  unit text,
  csd_code text,
  csd_name text,
  prov_code smallint,
  bu_use smallint,
  postal_code text,
  lat double precision not null,
  lng double precision not null
);

create table if not exists public.nar_addresses_position_backup (
  id bigint,
  lat double precision,
  lng double precision,
  town text
);

create table if not exists public.onboarding_config (
  id uuid default gen_random_uuid() not null,
  command_center_id uuid not null,
  reply_to_email text,
  facebook_group_url text,
  facebook_page_url text,
  instagram_url text,
  instagram_handle text,
  signature_name text,
  signature_title text,
  signature_phone text,
  signature_email text,
  updated_at timestamp with time zone default now()
);

create table if not exists public.pcl_cache (
  id uuid default gen_random_uuid() not null,
  command_center_id text not null,
  route_code text not null,
  clients jsonb default '[]'::jsonb not null,
  updated_at timestamp with time zone default now()
);

create table if not exists public.pcl_error_log (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now(),
  command_center_id uuid,
  worker_user_id text,
  route_codes text[],
  error_message text,
  error_stack text,
  user_agent text
);

create table if not exists public.pcl_geocode_cache (
  command_center_id text not null,
  address_key text not null,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.pending_sales (
  id text not null,
  session_id text not null,
  worker_id text not null,
  command_center_id uuid not null,
  session_date date not null,
  route_code text,
  house_number text,
  street_name text,
  price text,
  property_type text,
  services jsonb,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  sale_type text,
  parent_id text,
  assigned_rc_session_id text,
  asphalt_amount numeric,
  upsold_asphalt_amount numeric,
  shared_job_key text,
  first_name text,
  last_name text,
  phone text,
  email text
);

create table if not exists public.report_contractor_overrides (
  id uuid default gen_random_uuid() not null,
  kind text not null,
  payload jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.report_payable_cities (
  id uuid default gen_random_uuid() not null,
  name text not null,
  prefixes jsonb default '[]'::jsonb not null,
  region_splits jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.report_workbook_configs (
  id uuid default gen_random_uuid() not null,
  label text not null,
  sheet_id text not null,
  date_ranges jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.rf_prefix_mappings (
  id uuid default gen_random_uuid() not null,
  region text not null,
  call_book_prefix text not null,
  city_filter text,
  map_prefix text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.rf_review_queue (
  id uuid default gen_random_uuid() not null,
  scan_session_id uuid not null,
  customer_id text not null,
  map_prefix text not null,
  area_name text not null,
  first_name text,
  last_name text,
  phone text,
  house_num text,
  street_name text,
  city text,
  current_route_code text,
  suggested_route_code text,
  suggested_segment_name text,
  distance_deg numeric,
  pin_color text not null,
  lat numeric,
  lng numeric,
  rows jsonb default '[]'::jsonb not null,
  status text default 'pending'::text not null,
  fix_log jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.rf_scan_sessions (
  id uuid default gen_random_uuid() not null,
  region text not null,
  aeration_spreadsheet_id text,
  sealing_spreadsheet_id text,
  status text default 'discovering'::text not null,
  current_group text,
  groups_total integer default 0,
  groups_completed integer default 0,
  customers_total integer default 0,
  customers_fixed integer default 0,
  customers_queued integer default 0,
  customers_skipped integer default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.route_cleanup_pass (
  route_code text not null,
  removed integer,
  done_at timestamp with time zone default now()
);

create table if not exists public.route_finder_sessions (
  id uuid default gen_random_uuid() not null,
  spreadsheet_id text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  total_rows integer default 0,
  fixed_rows integer default 0,
  pending_row_ids jsonb default '[]'::jsonb,
  learned_streets jsonb default '{}'::jsonb,
  fix_log jsonb default '[]'::jsonb,
  learned_streets_original jsonb default '{}'::jsonb
);

create table if not exists public.route_historical_properties (
  id uuid default gen_random_uuid() not null,
  command_center_id uuid not null,
  session_date date not null,
  route_code text not null,
  address text not null,
  customer_name text,
  phone text,
  email text,
  client_type text,
  property_type text,
  notes text,
  price text,
  payment_type text,
  contractor_name text,
  created_at timestamp with time zone default now()
);

create table if not exists public.route_house_builds (
  route_code text not null,
  built_at timestamp with time zone default now() not null,
  source text not null,
  house_count integer default 0 not null,
  footprints_at timestamp with time zone,
  footprint_count integer default 0 not null,
  geocode_started_at timestamp with time zone,
  geocoded_at timestamp with time zone,
  geocode_note text
);

create table if not exists public.route_houses (
  id bigint default nextval('route_houses_id_seq'::regclass) not null,
  route_code text not null,
  house_key text not null,
  civic_no integer not null,
  civic_suffix text,
  street_name text not null,
  street_norm text not null,
  unit_count integer default 1 not null,
  lat double precision not null,
  lng double precision not null,
  footprint jsonb,
  source text default 'nar'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  geo_source text,
  geo_accuracy text,
  geocoded_at timestamp with time zone,
  unit text
);

create table if not exists public.route_houses_point_revert_backup (
  id bigint not null,
  route_code text not null,
  house_key text not null,
  old_lat double precision not null,
  old_lng double precision not null,
  old_geo_source text,
  old_geo_accuracy text,
  new_lat double precision not null,
  new_lng double precision not null,
  moved_m double precision,
  backed_up_at timestamp with time zone default now() not null
);

create table if not exists public.route_maps (
  id uuid default gen_random_uuid() not null,
  area_name text not null,
  route_number integer not null,
  route_code text not null,
  route_color text not null,
  segments jsonb default '[]'::jsonb not null,
  status text default 'pending'::text not null,
  ai_confidence integer,
  ai_notes text,
  approved_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.route_splits (
  id uuid default gen_random_uuid() not null,
  command_center_id text not null,
  session_date date not null,
  route_code text not null,
  buckets jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.route_street_checks (
  route_code text not null,
  street_norm text not null,
  street_name text,
  started_at timestamp with time zone default now() not null,
  checked_at timestamp with time zone,
  found integer,
  lookups integer
);

create table if not exists public.route_street_lines (
  id bigint default nextval('route_street_lines_id_seq'::regclass) not null,
  route_code text not null,
  street_norm text not null,
  street_base text not null,
  line geography not null,
  zone geometry not null
);

create table if not exists public.route_street_lines_loaded (
  route_code text not null,
  loaded_at timestamp with time zone default now()
);

create table if not exists public.routes (
  route_code text not null,
  session_date date not null,
  command_center_id uuid not null,
  manager_id text,
  streets text[] default '{}'::text[],
  assigned_worker_ids text[] default '{}'::text[]
);

create table if not exists public.shuttle_day_roster (
  id uuid default gen_random_uuid() not null,
  command_center_id uuid not null,
  date_tab text not null,
  contractor_id text not null,
  first_name text default ''::text not null,
  last_name text default ''::text not null,
  cell_phone text default ''::text not null,
  shuttle_number text default ''::text not null,
  confirmed boolean default false not null,
  showed boolean default false not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.shuttle_points (
  id uuid default gen_random_uuid() not null,
  command_center_id uuid not null,
  shuttle_number text not null,
  description text default ''::text not null,
  pickup_time text default ''::text not null,
  google_maps_url text default ''::text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.town_address_points (
  id bigint generated always as identity not null,
  civic_no integer not null,
  civic_suffix text,
  street_norm text not null,
  unit text,
  lat double precision not null,
  lng double precision not null,
  town text,
  street_name text,
  street_type text,
  street_dir text,
  postal_code text
);

create table if not exists public.town_load_progress (
  town text not null,
  next_offset integer default 0 not null,
  finished boolean default false not null,
  loaded integer default 0 not null
);

create table if not exists public.training_attempts (
  id uuid default gen_random_uuid() not null,
  contractor_id text not null,
  command_center_id text not null,
  module_id text not null,
  score integer not null,
  total_questions integer not null,
  passed boolean not null,
  attempted_at timestamp with time zone default now()
);

create table if not exists public.training_progress (
  id uuid default gen_random_uuid() not null,
  contractor_id text not null,
  command_center_id text not null,
  module_id text not null,
  is_completed boolean default false,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

create table if not exists public.transactions (
  id text not null,
  job_id text,
  worker_id text,
  "timestamp" timestamp with time zone,
  type text,
  price numeric,
  payment_method text,
  payment_breakdown jsonb,
  is_west_split boolean default false,
  display_price text,
  item_description text,
  customer_snapshot jsonb,
  items jsonb,
  client_snapshot jsonb,
  customer_name text,
  address text,
  customer_phone text,
  customer_email text,
  worker_name text,
  route_code text,
  region text,
  service_type text,
  invoice_number text,
  cheque_number text,
  cc_full_number text,
  cc_expiry text,
  cc_cvc text,
  etransfer_email text,
  command_center_id uuid not null,
  services jsonb default '{}'::jsonb,
  completed_by_worker_ids text[] default '{}'::text[],
  ref_id text,
  session_id text,
  payout_share numeric,
  asphalt_meta jsonb
);

create table if not exists public.users (
  user_id text not null,
  role text not null,
  name text not null,
  username text,
  password text,
  metadata jsonb default '{}'::jsonb,
  command_center_id uuid not null
);

create table if not exists public.worker_locations (
  worker_id text not null,
  command_center_id uuid not null,
  lat double precision not null,
  lng double precision not null,
  updated_at timestamp with time zone default now() not null,
  heading double precision,
  nav_active_at timestamp with time zone,
  nav_label text,
  nav_stops_left integer
);

create table if not exists public.worker_pcl_templates (
  contractor_id text not null,
  command_center_id text,
  body_text text not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.workerbook_confirmations (
  id uuid default gen_random_uuid() not null,
  command_center_id text not null,
  date_tab text not null,
  contractor_id text not null,
  confirmed_at timestamp with time zone default now() not null,
  synced_to_sheets boolean default false not null
);

create table if not exists public.workerbook_na_counts (
  id uuid default gen_random_uuid() not null,
  command_center_id uuid not null,
  contractor_id text not null,
  date_tab text not null,
  phone_type text not null,
  count integer default 0 not null,
  updated_at timestamp with time zone default now()
);


-- primary/unique/check
alter table public.job_fair_sessions add constraint job_fair_sessions_pkey PRIMARY KEY (id);
alter table public.job_fair_sessions add constraint job_fair_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text])));
alter table public.job_fair_sessions add constraint unique_active_session UNIQUE (command_center_id, status) DEFERRABLE INITIALLY DEFERRED;
alter table public.workerbook_na_counts add constraint workerbook_na_counts_phone_type_check CHECK ((phone_type = ANY (ARRAY['cell'::text, 'alt'::text])));
alter table public.workerbook_na_counts add constraint workerbook_na_counts_pkey PRIMARY KEY (id);
alter table public.workerbook_na_counts add constraint workerbook_na_counts_unique UNIQUE (command_center_id, contractor_id, date_tab, phone_type);
alter table public.job_fair_applicants add constraint job_fair_applicants_id_type_check CHECK ((id_type = ANY (ARRAY['SIN'::text, 'DL'::text, 'HEALTH_CARD'::text, 'PASSPORT'::text])));
alter table public.job_fair_applicants add constraint job_fair_applicants_pkey PRIMARY KEY (id);
alter table public.job_fair_applicants add constraint job_fair_applicants_rating_check CHECK (((rating >= 1) AND (rating <= 5)));
alter table public.manager_locations add constraint manager_locations_pkey PRIMARY KEY (manager_id);
alter table public.shuttle_day_roster add constraint shuttle_day_roster_pkey PRIMARY KEY (id);
alter table public.campaigns add constraint campaigns_pkey PRIMARY KEY (id);
alter table public.dialer_sessions add constraint dialer_sessions_campaign_id_manager_id_session_date_key UNIQUE (campaign_id, manager_id, session_date);
alter table public.dialer_sessions add constraint dialer_sessions_manager_date_unique UNIQUE (manager_id, session_date);
alter table public.dialer_sessions add constraint dialer_sessions_pkey PRIMARY KEY (id);
alter table public.campaign_managers add constraint campaign_managers_campaign_id_rep_code_key UNIQUE (campaign_id, rep_code);
alter table public.campaign_managers add constraint campaign_managers_pkey PRIMARY KEY (id);
alter table public.command_centers add constraint command_centers_job_fairs_slug_key UNIQUE (job_fairs_slug);
alter table public.command_centers add constraint command_centers_pkey PRIMARY KEY (id);
alter table public.command_centers add constraint command_centers_region_check CHECK ((region = ANY (ARRAY['West'::text, 'Central'::text, 'East'::text])));
alter table public.command_centers add constraint command_centers_username_key UNIQUE (username);
alter table public.pcl_error_log add constraint pcl_error_log_pkey PRIMARY KEY (id);
alter table public.users add constraint users_pkey PRIMARY KEY (user_id);
alter table public.pcl_cache add constraint pcl_cache_command_center_id_route_code_key UNIQUE (command_center_id, route_code);
alter table public.pcl_cache add constraint pcl_cache_pkey PRIMARY KEY (id);
alter table public.daily_sessions add constraint daily_sessions_pkey PRIMARY KEY (date, command_center_id);
alter table public.daily_sessions add constraint daily_sessions_season_type_check CHECK ((season_type = ANY (ARRAY['aeration'::text, 'lawn_rejuv'::text, 'sealing'::text, 'cleaning'::text])));
alter table public.bookings add constraint bookings_pkey PRIMARY KEY (booking_id, command_center_id);
alter table public.logsheet_sessions add constraint logsheet_sessions_pkey PRIMARY KEY (id);
alter table public.logsheet_sessions add constraint logsheet_sessions_worker_date_cc_unique UNIQUE (worker_id, date, command_center_id);
alter table public.bambora_idempotency add constraint bambora_idempotency_pkey PRIMARY KEY (idempotency_key);
alter table public.bambora_idempotency add constraint bambora_idempotency_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'approved'::text, 'declined'::text, 'error'::text])));
alter table public.routes add constraint routes_pkey PRIMARY KEY (route_code, session_date, command_center_id);
alter table public.email_templates add constraint email_templates_pkey PRIMARY KEY (id);
alter table public.email_templates add constraint email_templates_unique_type UNIQUE (command_center_id, template_type);
alter table public.transactions add constraint transactions_pkey PRIMARY KEY (id);
alter table public.email_logs add constraint email_logs_pkey PRIMARY KEY (id);
alter table public.route_finder_sessions add constraint route_finder_sessions_pkey PRIMARY KEY (id);
alter table public.route_finder_sessions add constraint route_finder_sessions_spreadsheet_id_key UNIQUE (spreadsheet_id);
alter table public.geocode_cache add constraint geocode_cache_pkey PRIMARY KEY (address_key, command_center_id, session_date);
alter table public.route_historical_properties add constraint rhp_pkey PRIMARY KEY (id);
alter table public.pending_sales add constraint pending_sales_asphalt_amount_chk CHECK (((sale_type IS DISTINCT FROM 'asphalt'::text) OR (asphalt_amount IS NOT NULL)));
alter table public.pending_sales add constraint pending_sales_pkey PRIMARY KEY (id);
alter table public.dialer_team_events add constraint dialer_team_events_pkey PRIMARY KEY (id);
alter table public.training_progress add constraint training_progress_pkey PRIMARY KEY (id);
alter table public.contractors add constraint contractors_pkey PRIMARY KEY (id);
alter table public.route_splits add constraint route_splits_pkey PRIMARY KEY (id);
alter table public.route_splits add constraint route_splits_unique_per_session UNIQUE (command_center_id, session_date, route_code);
alter table public.dialer_presence add constraint dialer_presence_pkey PRIMARY KEY (manager_id);
alter table public.na_cooldown_log add constraint na_cooldown_log_pkey PRIMARY KEY (id);
alter table public.training_attempts add constraint training_attempts_pkey PRIMARY KEY (id);
alter table public.map_pins add constraint map_pins_pkey PRIMARY KEY (id);
alter table public.town_load_progress add constraint town_load_progress_pkey PRIMARY KEY (town);
alter table public.route_maps add constraint route_maps_area_name_route_number_key UNIQUE (area_name, route_number);
alter table public.route_maps add constraint route_maps_pkey PRIMARY KEY (id);
alter table public.campaign_books add constraint campaign_books_pkey PRIMARY KEY (id);
alter table public.cut_bookings add constraint cut_bookings_book_id_booking_id_key UNIQUE (book_id, booking_id);
alter table public.cut_bookings add constraint cut_bookings_pkey PRIMARY KEY (id);
alter table public.shuttle_points add constraint shuttle_points_pkey PRIMARY KEY (id);
alter table public.shuttle_points add constraint shuttle_points_unique UNIQUE (command_center_id, shuttle_number);
alter table public.pcl_geocode_cache add constraint pcl_geocode_cache_pkey PRIMARY KEY (command_center_id, address_key);
alter table public.onboarding_config add constraint onboarding_config_command_center_id_key UNIQUE (command_center_id);
alter table public.onboarding_config add constraint onboarding_config_pkey PRIMARY KEY (id);
alter table public.area_prefixes add constraint area_prefixes_pkey PRIMARY KEY (area_name);
alter table public.map_pcl_cache add constraint map_pcl_cache_pkey PRIMARY KEY (route_code);
alter table public.rf_prefix_mappings add constraint rf_prefix_mappings_pkey PRIMARY KEY (id);
alter table public.rf_prefix_mappings add constraint rf_prefix_mappings_region_check CHECK ((region = ANY (ARRAY['East'::text, 'Central'::text, 'West'::text])));
alter table public.rf_prefix_mappings add constraint rf_prefix_mappings_unique UNIQUE (region, call_book_prefix, city_filter);
alter table public.rf_scan_sessions add constraint rf_scan_sessions_pkey PRIMARY KEY (id);
alter table public.rf_scan_sessions add constraint rf_scan_sessions_region_check CHECK ((region = ANY (ARRAY['East'::text, 'Central'::text, 'West'::text])));
alter table public.rf_scan_sessions add constraint rf_scan_sessions_status_check CHECK ((status = ANY (ARRAY['discovering'::text, 'confirming'::text, 'scanning'::text, 'reviewing'::text, 'complete'::text])));
alter table public.rf_review_queue add constraint rf_review_queue_pin_color_check CHECK ((pin_color = ANY (ARRAY['orange'::text, 'red'::text])));
alter table public.rf_review_queue add constraint rf_review_queue_pkey PRIMARY KEY (id);
alter table public.rf_review_queue add constraint rf_review_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'fixed'::text, 'skipped'::text])));
alter table public.rf_review_queue add constraint rf_review_queue_unique UNIQUE (scan_session_id, customer_id);
alter table public.workerbook_confirmations add constraint workerbook_confirmations_command_center_id_date_tab_contrac_key UNIQUE (command_center_id, date_tab, contractor_id);
alter table public.workerbook_confirmations add constraint workerbook_confirmations_pkey PRIMARY KEY (id);
alter table public.gallery_steps add constraint gallery_steps_pkey PRIMARY KEY (id);
alter table public.map_logsheet_cc_access add constraint map_logsheet_cc_access_pkey PRIMARY KEY (command_center_id);
alter table public.worker_locations add constraint worker_locations_pkey PRIMARY KEY (worker_id);
alter table public.building_footprints add constraint building_footprints_pkey PRIMARY KEY (id);
alter table public.worker_pcl_templates add constraint worker_pcl_templates_pkey PRIMARY KEY (contractor_id);
alter table public.route_houses_point_revert_backup add constraint route_houses_point_revert_backup_pkey PRIMARY KEY (id);
alter table public.map_logsheet_access add constraint map_logsheet_access_pkey PRIMARY KEY (contractor_id);
alter table public.route_street_lines add constraint route_street_lines_pkey PRIMARY KEY (id);
alter table public.report_workbook_configs add constraint report_workbook_configs_pkey PRIMARY KEY (id);
alter table public.report_payable_cities add constraint report_payable_cities_pkey PRIMARY KEY (id);
alter table public.route_street_lines_loaded add constraint route_street_lines_loaded_pkey PRIMARY KEY (route_code);
alter table public.route_cleanup_pass add constraint route_cleanup_pass_pkey PRIMARY KEY (route_code);
alter table public.town_address_points add constraint city_address_points_pkey PRIMARY KEY (id);
alter table public.route_street_checks add constraint route_street_checks_pkey PRIMARY KEY (route_code, street_norm);
alter table public.house_dispositions add constraint house_dispositions_pkey PRIMARY KEY (id);
alter table public.house_dispositions add constraint house_dispositions_route_code_house_key_key UNIQUE (route_code, house_key);
alter table public.house_dispositions add constraint house_dispositions_status_check CHECK ((status = ANY (ARRAY['no'::text, 'not_home'::text, 'go_back'::text, 'invalid'::text])));
alter table public.route_house_builds add constraint route_house_builds_pkey PRIMARY KEY (route_code);
alter table public.route_houses add constraint route_houses_pkey PRIMARY KEY (id);
alter table public.route_houses add constraint route_houses_route_code_house_key_key UNIQUE (route_code, house_key);
alter table public.report_contractor_overrides add constraint report_contractor_overrides_pkey PRIMARY KEY (id);
alter table public.nar_addresses add constraint nar_addresses_pkey PRIMARY KEY (id);


-- foreign keys
alter table public.job_fair_sessions add constraint job_fair_sessions_command_center_id_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id) ON DELETE CASCADE;
alter table public.workerbook_na_counts add constraint workerbook_na_counts_cc_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id);
alter table public.job_fair_applicants add constraint job_fair_applicants_command_center_id_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id) ON DELETE CASCADE;
alter table public.job_fair_applicants add constraint job_fair_applicants_session_id_fkey FOREIGN KEY (session_id) REFERENCES job_fair_sessions(id) ON DELETE CASCADE;
alter table public.manager_locations add constraint manager_locations_command_center_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id);
alter table public.shuttle_day_roster add constraint shuttle_day_roster_cc_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id);
alter table public.dialer_sessions add constraint dialer_sessions_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
alter table public.dialer_sessions add constraint dialer_sessions_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES campaign_managers(id) ON DELETE CASCADE;
alter table public.campaign_managers add constraint campaign_managers_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
alter table public.users add constraint users_command_center_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id) ON DELETE CASCADE;
alter table public.daily_sessions add constraint daily_sessions_command_center_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id) ON DELETE CASCADE;
alter table public.bookings add constraint bookings_command_center_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id) ON DELETE CASCADE;
alter table public.bookings add constraint bookings_contractor_id_fkey FOREIGN KEY (contractor_id) REFERENCES users(user_id) ON DELETE SET NULL;
alter table public.bookings add constraint bookings_session_fkey FOREIGN KEY (session_date, command_center_id) REFERENCES daily_sessions(date, command_center_id) ON DELETE CASCADE;
alter table public.logsheet_sessions add constraint logsheet_sessions_command_center_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id) ON DELETE CASCADE;
alter table public.logsheet_sessions add constraint logsheet_sessions_session_fkey FOREIGN KEY (date, command_center_id) REFERENCES daily_sessions(date, command_center_id) ON DELETE CASCADE;
alter table public.logsheet_sessions add constraint logsheet_sessions_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES users(user_id) ON DELETE CASCADE;
alter table public.routes add constraint routes_command_center_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id) ON DELETE CASCADE;
alter table public.routes add constraint routes_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES users(user_id) ON DELETE SET NULL;
alter table public.routes add constraint routes_session_fkey FOREIGN KEY (session_date, command_center_id) REFERENCES daily_sessions(date, command_center_id) ON DELETE CASCADE;
alter table public.email_templates add constraint email_templates_command_center_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id) ON DELETE CASCADE;
alter table public.transactions add constraint transactions_command_center_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id) ON DELETE CASCADE;
alter table public.transactions add constraint transactions_worker_id_fkey FOREIGN KEY (worker_id) REFERENCES users(user_id) ON DELETE SET NULL;
alter table public.geocode_cache add constraint geocode_cache_cc_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id);
alter table public.route_historical_properties add constraint rhp_cc_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id);
alter table public.dialer_team_events add constraint dialer_team_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
alter table public.dialer_team_events add constraint dialer_team_events_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES campaign_managers(id) ON DELETE CASCADE;
alter table public.na_cooldown_log add constraint na_cooldown_log_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
alter table public.campaign_books add constraint campaign_books_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE;
alter table public.cut_bookings add constraint cut_bookings_book_id_fkey FOREIGN KEY (book_id) REFERENCES campaign_books(id) ON DELETE CASCADE;
alter table public.shuttle_points add constraint shuttle_points_command_center_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id);
alter table public.onboarding_config add constraint onboarding_config_command_center_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id);
alter table public.rf_review_queue add constraint rf_review_queue_scan_session_fkey FOREIGN KEY (scan_session_id) REFERENCES rf_scan_sessions(id) ON DELETE CASCADE;
alter table public.map_logsheet_cc_access add constraint map_logsheet_cc_access_command_center_id_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id) ON DELETE CASCADE;
alter table public.worker_locations add constraint worker_locations_command_center_fkey FOREIGN KEY (command_center_id) REFERENCES command_centers(id) ON DELETE CASCADE;


-- indexes
CREATE INDEX route_street_lines_street_idx ON public.route_street_lines USING btree (street_norm);
CREATE INDEX rf_review_queue_prefix ON public.rf_review_queue USING btree (scan_session_id, map_prefix, status);
CREATE INDEX idx_campaign_managers_campaign ON public.campaign_managers USING btree (campaign_id);
CREATE INDEX training_attempts_contractor_idx ON public.training_attempts USING btree (contractor_id);
CREATE INDEX idx_pending_sales_shared_job_key ON public.pending_sales USING btree (shared_job_key) WHERE (shared_job_key IS NOT NULL);
CREATE INDEX pending_sales_unassigned_asphalt_idx ON public.pending_sales USING btree (command_center_id, session_date) WHERE ((sale_type = 'asphalt'::text) AND (assigned_rc_session_id IS NULL));
CREATE INDEX training_attempts_module_idx ON public.training_attempts USING btree (module_id);
CREATE INDEX workerbook_confirmations_lookup ON public.workerbook_confirmations USING btree (command_center_id, date_tab);
CREATE INDEX idx_logsheet_sessions_status ON public.logsheet_sessions USING btree (status);
CREATE INDEX transactions_asphalt_meta_idx ON public.transactions USING btree (command_center_id) WHERE (asphalt_meta IS NOT NULL);
CREATE INDEX idx_cut_bookings_book_id ON public.cut_bookings USING btree (book_id);
CREATE INDEX rf_review_queue_session_status ON public.rf_review_queue USING btree (scan_session_id, status);
CREATE INDEX training_progress_contractor_idx ON public.training_progress USING btree (contractor_id);
CREATE INDEX route_street_lines_line_idx ON public.route_street_lines USING gist (line);
CREATE INDEX idx_email_templates_command_center ON public.email_templates USING btree (command_center_id);
CREATE INDEX idx_shuttle_day_roster_lookup ON public.shuttle_day_roster USING btree (command_center_id, date_tab);
CREATE INDEX idx_logsheet_sessions_date ON public.logsheet_sessions USING btree (date, command_center_id);
CREATE INDEX town_address_points_town_idx ON public.town_address_points USING btree (town);
CREATE INDEX idx_rhp_cc_route ON public.route_historical_properties USING btree (command_center_id, route_code);
CREATE INDEX idx_job_fair_applicants_last_name ON public.job_fair_applicants USING btree (last_name);
CREATE INDEX training_progress_cc_idx ON public.training_progress USING btree (command_center_id);
CREATE INDEX route_houses_route_idx ON public.route_houses USING btree (route_code);
CREATE UNIQUE INDEX contractors_id_cc_unique ON public.contractors USING btree (contractor_id, command_center_id);
CREATE INDEX idx_logsheet_sessions_team_worker_ids ON public.logsheet_sessions USING gin (team_worker_ids);
CREATE INDEX nar_addresses_prov_idx ON public.nar_addresses USING btree (prov_code);
CREATE INDEX idx_dialer_presence_campaign ON public.dialer_presence USING btree (campaign_id);
CREATE INDEX idx_logsheet_sessions_worker ON public.logsheet_sessions USING btree (worker_id);
CREATE INDEX idx_bookings_route ON public.bookings USING btree (route_number);
CREATE UNIQUE INDEX training_progress_contractor_module_unique ON public.training_progress USING btree (contractor_id, module_id);
CREATE INDEX idx_email_logs_status ON public.email_logs USING btree (status);
CREATE INDEX town_address_points_key_idx ON public.town_address_points USING btree (street_norm, civic_no);
CREATE INDEX map_pins_worker_stops_idx ON public.map_pins USING btree (command_center_id, session_date, target_worker_id) WHERE (target_worker_id IS NOT NULL);
CREATE INDEX idx_route_splits_cc_date ON public.route_splits USING btree (command_center_id, session_date);
CREATE INDEX idx_routes_manager ON public.routes USING btree (manager_id);
CREATE INDEX idx_geocode_cc_date ON public.geocode_cache USING btree (command_center_id, session_date);
CREATE INDEX idx_job_fair_applicants_command_center ON public.job_fair_applicants USING btree (command_center_id);
CREATE INDEX na_cooldown_log_campaign_created ON public.na_cooldown_log USING btree (campaign_id, created_at DESC);
CREATE INDEX idx_email_logs_transaction ON public.email_logs USING btree (transaction_id);
CREATE INDEX route_street_lines_route_idx ON public.route_street_lines USING btree (route_code);
CREATE INDEX na_cooldown_log_phone ON public.na_cooldown_log USING btree (phone);
CREATE INDEX map_pins_cc_date_idx ON public.map_pins USING btree (command_center_id, session_date);
CREATE INDEX idx_users_command_center ON public.users USING btree (command_center_id);
CREATE INDEX gallery_steps_contractor_idx ON public.gallery_steps USING btree (contractor_id, "position");
CREATE INDEX idx_transactions_job ON public.transactions USING btree (job_id);
CREATE INDEX idx_transactions_command_center ON public.transactions USING btree (command_center_id);
CREATE INDEX idx_campaign_managers_rep_code ON public.campaign_managers USING btree (rep_code);
CREATE INDEX training_attempts_cc_idx ON public.training_attempts USING btree (command_center_id);
CREATE INDEX idx_dialer_team_events_campaign ON public.dialer_team_events USING btree (campaign_id, created_at DESC);
CREATE INDEX idx_job_fair_sessions_active ON public.job_fair_sessions USING btree (command_center_id, status) WHERE (status = 'active'::text);
CREATE INDEX map_pcl_cache_area_idx ON public.map_pcl_cache USING btree (area_name);
CREATE INDEX contractors_cc_idx ON public.contractors USING btree (command_center_id);
CREATE INDEX idx_contractors_level_2_unlocked ON public.contractors USING btree (command_center_id, level_2_unlocked_at) WHERE (level_2_unlocked_at IS NOT NULL);
CREATE INDEX idx_command_centers_job_fairs_slug ON public.command_centers USING btree (job_fairs_slug) WHERE (job_fairs_slug IS NOT NULL);
CREATE INDEX idx_transactions_timestamp ON public.transactions USING btree ("timestamp");
CREATE INDEX idx_dialer_sessions_manager ON public.dialer_sessions USING btree (manager_id);
CREATE INDEX idx_bookings_status ON public.bookings USING btree (status);
CREATE INDEX idx_users_username ON public.users USING btree (username);
CREATE INDEX idx_routes_session ON public.routes USING btree (session_date, command_center_id);
CREATE INDEX house_dispositions_route_idx ON public.house_dispositions USING btree (route_code);
CREATE INDEX idx_users_role ON public.users USING btree (role);
CREATE INDEX idx_bookings_contractor ON public.bookings USING btree (contractor_id);
CREATE INDEX idx_dialer_sessions_date ON public.dialer_sessions USING btree (session_date);
CREATE INDEX idx_rhp_session ON public.route_historical_properties USING btree (command_center_id, session_date);
CREATE INDEX idx_transactions_worker ON public.transactions USING btree (worker_id);
CREATE INDEX pending_sales_parent_id_idx ON public.pending_sales USING btree (parent_id) WHERE (parent_id IS NOT NULL);
CREATE INDEX idx_job_fair_applicants_session ON public.job_fair_applicants USING btree (session_id);
CREATE INDEX idx_bookings_session ON public.bookings USING btree (session_date, command_center_id);
CREATE INDEX route_street_lines_zone_idx ON public.route_street_lines USING gist (zone);


-- functions
CREATE OR REPLACE FUNCTION public.is_username_available(check_username text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Check command_centers table
  IF EXISTS (SELECT 1 FROM public.command_centers WHERE username = check_username) THEN
    RETURN false;
  END IF;
  
  -- Check users table (Route Managers use username field)
  IF EXISTS (SELECT 1 FROM public.users WHERE username = check_username) THEN
    RETURN false;
  END IF;
  
  -- Check users table (Workers use user_id as their login)
  IF EXISTS (SELECT 1 FROM public.users WHERE user_id = check_username) THEN
    RETURN false;
  END IF;
  
  RETURN true;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_job_fair_applicant_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_route_houses(p_route_code text, p_houses jsonb, p_source text DEFAULT 'osm'::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  insert into route_houses (route_code, house_key, civic_no, civic_suffix,
                            street_name, street_norm, unit_count, lat, lng, source)
  select p_route_code,
         house_key((h->>'civicNo')::int, h->>'suffix', norm_street(h->>'street')),
         (h->>'civicNo')::int,
         nullif(h->>'suffix', ''),
         initcap(h->>'street'),
         norm_street(h->>'street'),
         coalesce((h->>'unitCount')::int, 1),
         (h->>'lat')::float8,
         (h->>'lng')::float8,
         p_source
  from jsonb_array_elements(p_houses) as h
  where (h->>'civicNo') ~ '^[0-9]+$'
    and norm_street(h->>'street') is not null
  on conflict (route_code, house_key) do update
    set lat = excluded.lat,
        lng = excluded.lng,
        updated_at = now()
    where route_houses.source <> 'nar'
      and route_houses.geo_source is null;

  select count(*) into v_count from route_houses where route_code = p_route_code;

  insert into route_house_builds (route_code, built_at, source, house_count)
  values (p_route_code, now(), p_source, v_count)
  on conflict (route_code) do update
    set built_at = now(),
        source = case when route_house_builds.source = 'nar' and excluded.source <> 'nar'
                      then 'mixed' else excluded.source end,
        house_count = excluded.house_count;

  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_route_street_lines(p_route_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  delete from route_street_lines where route_code = p_route_code;
  insert into route_street_lines (route_code, street_norm, street_base, line, zone)
  select x.route_code, x.street_norm, regexp_replace(x.street_norm, '\s+\S+$', ''), x.line,
         ST_Union(ST_Buffer(x.line, 60, 'endcap=flat')::geometry, ST_Buffer(x.line, 12)::geometry)
  from (
    select rm.route_code,
           norm_street(s.seg->>'name') as street_norm,
           ST_MakeLine(array(
             select ST_SetSRID(ST_MakePoint((c->>0)::float8, (c->>1)::float8), 4326)
             from jsonb_array_elements(s.seg->'coordinates') with ordinality as t(c, ord)
             order by ord))::geography as line
    from route_maps rm, jsonb_array_elements(rm.segments) as s(seg)
    where rm.route_code = p_route_code
      and rm.status = 'approved'
      and jsonb_array_length(s.seg->'coordinates') >= 2
      and norm_street(s.seg->>'name') is not null
  ) x;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.route_maps_lines_trigger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform refresh_route_street_lines(old.route_code);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.route_code is distinct from old.route_code) then
    perform refresh_route_street_lines(new.route_code);
  end if;
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.route_splits_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.norm_street(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select nullif(trim(array_to_string(array(
    select case w
      -- street types
      when 'street'     then 'st'
      when 'avenue'     then 'ave'
      when 'av'         then 'ave'
      when 'road'       then 'rd'
      when 'drive'      then 'dr'
      when 'crescent'   then 'cres'
      when 'cr'         then 'cres'
      when 'court'      then 'crt'
      when 'ct'         then 'crt'
      when 'boulevard'  then 'blvd'
      when 'lane'       then 'ln'
      when 'place'      then 'pl'
      when 'circle'     then 'cir'
      when 'trail'      then 'trl'
      when 'terrace'    then 'terr'
      when 'ter'        then 'terr'
      when 'parkway'    then 'pky'
      when 'pkwy'       then 'pky'
      when 'gardens'    then 'gdns'
      when 'heights'    then 'hts'
      when 'grove'      then 'grv'
      when 'square'     then 'sq'
      when 'crossing'   then 'cross'
      when 'sideroad'   then 'sdrd'
      when 'concession' then 'conc'
      when 'highway'    then 'hwy'
      when 'private'    then 'pvt'
      when 'mews'       then 'mews'
      when 'landing'    then 'landng'
      when 'hollow'     then 'hollow'
      when 'pathway'    then 'ptway'
      when 'promenade'  then 'prom'
      when 'esplanade'  then 'espl'
      when 'extension'  then 'exten'
      when 'expressway' then 'expy'
      when 'freeway'    then 'fwy'
      -- directions
      when 'north'      then 'n'
      when 'south'      then 's'
      when 'east'       then 'e'
      when 'west'       then 'w'
      when 'northeast'  then 'ne'
      when 'northwest'  then 'nw'
      when 'southeast'  then 'se'
      when 'southwest'  then 'sw'
      when 'nord'       then 'n'
      when 'sud'        then 's'
      when 'est'        then 'e'
      when 'ouest'      then 'w'
      else w
    end
    from unnest(regexp_split_to_array(
      regexp_replace(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g'),
      ' ')) as w
    where w <> ''
  ), ' ')), '');
$function$
;

CREATE OR REPLACE FUNCTION public.house_key(p_civic_no integer, p_suffix text, p_street_norm text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select p_civic_no::text || lower(coalesce(p_suffix, '')) || '|' || coalesce(p_street_norm, '');
$function$
;

CREATE OR REPLACE FUNCTION public.load_oakville_points_batch(p_pages integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_off   integer;
  v_resp  jsonb;
  v_added integer := 0;
  v_n     integer;
  i       integer;
begin
  insert into town_load_progress (town) values ('Oakville') on conflict do nothing;
  select next_offset into v_off from town_load_progress where town = 'Oakville' and not finished;
  if v_off is null then return 0; end if;

  perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '30000');

  for i in 1..p_pages loop
    select content::jsonb into v_resp
    from http_get(
      'https://services5.arcgis.com/QJebCdoMf4PF8fJP/ArcGIS/rest/services/Parcels_Addresses/FeatureServer/0/query'
      || '?f=json&where=1%3D1&returnGeometry=false&returnCentroid=true&outSR=4326'
      || '&outFields=STREET_NUM,SUFFIX,CIVIC_NUMBER,CIVIC_NUMBER_SUFFIX,STREET_NAME,STREET_TYPE,STREET_DIR,STREET_TYPE_PREFIX,UNIT,POSTAL_CODE'
      || '&orderByFields=OBJECTID&resultRecordCount=1000&resultOffset=' || v_off);

    if v_resp is null or v_resp ? 'error' then
      raise exception 'Oakville''s server didn''t answer properly at lot % — just run this line again.', v_off;
    end if;

    if jsonb_array_length(coalesce(v_resp->'features', '[]'::jsonb)) = 0 then
      update town_load_progress set finished = true where town = 'Oakville';
      exit;
    end if;

    insert into town_address_points
      (town, civic_no, civic_suffix, street_name, street_type, street_dir, unit, postal_code, lat, lng, street_norm)
    select 'Oakville', x.civic_no, x.sfx, x.street_name, x.street_type, x.street_dir, x.unit, x.postal, x.lat, x.lng,
           norm_street(x.street_name || ' ' || coalesce(x.street_type, '') || ' ' || coalesce(x.street_dir, ''))
    from (
      select (regexp_match(coalesce(f->'attributes'->>'STREET_NUM', f->'attributes'->>'CIVIC_NUMBER', ''), '^\s*(\d+)'))[1]::int as civic_no,
             nullif(upper(trim(coalesce(nullif(trim(f->'attributes'->>'SUFFIX'), ''), f->'attributes'->>'CIVIC_NUMBER_SUFFIX', ''))), '') as sfx,
             nullif(trim(concat_ws(' ', nullif(trim(f->'attributes'->>'STREET_TYPE_PREFIX'), ''), f->'attributes'->>'STREET_NAME')), '') as street_name,
             nullif(trim(f->'attributes'->>'STREET_TYPE'), '') as street_type,
             nullif(trim(f->'attributes'->>'STREET_DIR'), '') as street_dir,
             nullif(trim(f->'attributes'->>'UNIT'), '') as unit,
             nullif(trim(f->'attributes'->>'POSTAL_CODE'), '') as postal,
             (f->'centroid'->>'y')::float8 as lat,
             (f->'centroid'->>'x')::float8 as lng
      from jsonb_array_elements(v_resp->'features') f
    ) x
    where x.civic_no is not null and x.street_name is not null and x.lat is not null;
    get diagnostics v_n = row_count;
    v_added := v_added + v_n;

    v_off := v_off + jsonb_array_length(v_resp->'features');
    update town_load_progress set next_offset = v_off, loaded = loaded + v_n where town = 'Oakville';
  end loop;

  return v_added;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_route_house_footprints(p_route_code text, p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_updated integer;
  v_total   integer;
begin
  update route_houses rh
     set footprint = i.fp,
         updated_at = now()
  from (
    select it->>'houseKey' as hk, it->'footprint' as fp
    from jsonb_array_elements(p_items) as it
  ) i
  where rh.route_code = p_route_code
    and rh.house_key = i.hk;

  get diagnostics v_updated = row_count;

  -- NEW: fill any house still without an outline from building_footprints.
  perform attach_route_house_footprints(p_route_code);

  select count(*) into v_total from route_houses
  where route_code = p_route_code and footprint is not null;

  update route_house_builds
     set footprints_at = now(), footprint_count = v_total
  where route_code = p_route_code;

  return v_updated;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.attach_route_house_footprints(p_route_code text, p_max_m integer DEFAULT 18)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_updated integer;
begin
  with pts as (
    -- every house on the route still without an outline
    select h.house_key, ST_SetSRID(ST_MakePoint(h.lng, h.lat), 4326) as pt
    from route_houses h
    where h.route_code = p_route_code and h.footprint is null
  ),
  m as (
    -- best building per house: the one it sits in, else the nearest within p_max_m
    select p.house_key, p.pt, f.id as bid, f.geom as bgeom, f.inside
    from pts p
    cross join lateral (
      select bf.id, bf.geom, ST_Contains(bf.geom, p.pt) as inside
      from building_footprints bf
      where ST_DWithin(bf.geom, p.pt, 0.0004)
        and ST_DWithin(bf.geom::geography, p.pt::geography, p_max_m)
      order by ST_Contains(bf.geom, p.pt) desc, bf.geom::geography <-> p.pt::geography
      limit 1
    ) f
  ),
  kept as (
    -- a house only "borrows" a nearby building if no house sits inside that building
    select m.* from m
    where m.inside or not exists (select 1 from m m2 where m2.bid = m.bid and m2.inside)
  ),
  grp as (
    select bid, count(*) as n, ST_Collect(pt) as pts from kept group by bid
  ),
  cells as (
    -- buildings shared by several houses: cut into one slice per house (Voronoi)
    select g.bid, (ST_Dump(ST_VoronoiPolygons(g.pts, 0, ST_Expand(bf.geom, 0.001)))).geom as cell
    from grp g join building_footprints bf on bf.id = g.bid
    where g.n > 1
  ),
  assign as (
    select k.house_key,
      coalesce(
        case when g.n = 1 then k.bgeom else (
          select s from (
            select ST_CollectionExtract(ST_Intersection(k.bgeom, c.cell), 3) as s
            from cells c where c.bid = k.bid and ST_Intersects(c.cell, k.pt) limit 1
          ) x where not ST_IsEmpty(s)
        ) end,
        k.bgeom) as shape
    from kept k join grp g on g.bid = k.bid
  )
  update route_houses rh
     set footprint = ST_AsGeoJSON(a.shape)::jsonb,
         updated_at = now()
  from assign a
  where rh.route_code = p_route_code
    and rh.house_key = a.house_key;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.other_route_street_hit(p_route_code text, p_street_norm text, p_pt geometry)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from route_street_lines l
    where l.street_norm = p_street_norm
      and l.route_code <> p_route_code
      and ST_Intersects(l.zone, p_pt)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.claim_route_geocode(p_route_code text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ok boolean;
begin
  update route_house_builds
     set geocode_started_at = now()
   where route_code = p_route_code
     and geocoded_at is null
     and (geocode_started_at is null or geocode_started_at < now() - interval '10 minutes')
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.route_street_hit(p_route_code text, p_street_norm text, p_pt geometry, p_flat boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from route_street_lines l
    where l.route_code = p_route_code
      and (l.street_norm = p_street_norm
           or (l.street_base = regexp_replace(p_street_norm, '\s+\S+$', '')
               and not exists (select 1 from route_street_lines x
                               where x.route_code = p_route_code and x.street_norm = p_street_norm)))
      and (case when p_flat then ST_Intersects(l.zone, p_pt)
                else ST_DWithin(l.line, p_pt::geography, 60) end)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.claim_street_check(p_route_code text, p_street_norm text, p_street_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ok boolean;
begin
  insert into route_street_checks (route_code, street_norm, street_name)
  values (p_route_code, p_street_norm, p_street_name)
  on conflict (route_code, street_norm) do update
     set started_at = now()
   where route_street_checks.checked_at is null
     and route_street_checks.started_at < now() - interval '10 minutes'
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.add_street_houses(p_route_code text, p_street_norm text, p_items jsonb, p_lookups integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n integer;
begin
  insert into route_houses (route_code, house_key, civic_no, civic_suffix, street_name, street_norm,
                            unit_count, lat, lng, source, geo_source, geo_accuracy, geocoded_at)
  select p_route_code,
         house_key((i->>'civicNo')::int, nullif(i->>'suffix', ''), norm_street(i->>'street')),
         (i->>'civicNo')::int,
         nullif(i->>'suffix', ''),
         i->>'street',
         norm_street(i->>'street'),
         1,
         (i->>'lat')::float8,
         (i->>'lng')::float8,
         'mapbox', 'mapbox', i->>'accuracy', now()
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as i
  where (i->>'civicNo') ~ '^[0-9]+$'
    and norm_street(i->>'street') is not null
    -- only on this route's own stretch of the street (never a neighbour's)
    and route_street_hit(p_route_code, norm_street(i->>'street'),
                         ST_SetSRID(ST_MakePoint((i->>'lng')::float8, (i->>'lat')::float8), 4326), true)
  on conflict (route_code, house_key) do nothing;
  get diagnostics v_n = row_count;

  update route_street_checks
     set checked_at = now(), found = v_n, lookups = p_lookups
   where route_code = p_route_code and street_norm = p_street_norm;

  update route_house_builds
     set house_count = (select count(*) from route_houses where route_code = p_route_code)
   where route_code = p_route_code;

  return v_n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reopen_route_geocode(p_route_code text)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  update route_house_builds
     set geocoded_at = null, geocode_started_at = null
   where route_code = p_route_code;
$function$
;

CREATE OR REPLACE FUNCTION public.build_route_houses(p_route_code text, p_buffer_m integer DEFAULT 60)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lines   geography;
  v_names   text[];
  v_bases   text[];
  v_count   integer;
  v_x       integer;
  v_private geography;
begin
  select ST_Union(l.line)::geography
    into v_lines
  from (
    select ST_MakeLine(
             ST_SetSRID(ST_MakePoint((c->>0)::float8, (c->>1)::float8), 4326)
             order by ord
           ) as line
    from route_maps rm,
         jsonb_array_elements(rm.segments) with ordinality as s(seg, sord),
         jsonb_array_elements(s.seg->'coordinates') with ordinality as t(c, ord)
    where rm.route_code = p_route_code
      and rm.status = 'approved'
    group by rm.id, s.sord
    having count(*) >= 2
  ) l;
  if v_lines is null then
    return 0;
  end if;

  -- The route's unnamed lines: private roads of complexes drawn into the route.
  select ST_Union(l.line)::geography
    into v_private
  from (
    select ST_MakeLine(
             ST_SetSRID(ST_MakePoint((c->>0)::float8, (c->>1)::float8), 4326)
             order by ord
           ) as line
    from route_maps rm,
         jsonb_array_elements(rm.segments) with ordinality as s(seg, sord),
         jsonb_array_elements(s.seg->'coordinates') with ordinality as t(c, ord)
    where rm.route_code = p_route_code
      and rm.status = 'approved'
      and coalesce(trim(s.seg->>'name'), '') = ''
    group by rm.id, s.sord
    having count(*) >= 2
  ) l;

  select array_agg(distinct n)
    into v_names
  from (
    select norm_street(seg->>'name') as n
    from route_maps rm, jsonb_array_elements(rm.segments) as seg
    where rm.route_code = p_route_code and rm.status = 'approved'
  ) s
  where n is not null;
  if v_names is null then
    return 0;
  end if;

  -- Different street ending in the register ("Way" vs "Lane"): only for
  -- names with no exact match along the route.
  select array_agg(distinct regexp_replace(n, '\s+\S+$', ''))
    into v_bases
  from unnest(v_names) as n
  where n ~ '\s'
    and not exists (select 1 from nar_addresses a
                    where a.street_norm = n and ST_DWithin(a.geom, v_lines, p_buffer_m));

  with cand as materialized (
    -- register addresses on the route's streets (units can sit deep in a complex)
    select a.* from nar_addresses a
    where a.civic_no is not null
      and a.bu_use in (1, 2)
      and (a.street_norm = any (v_names)
           or (v_bases is not null and regexp_replace(a.street_norm, '\s+\S+$', '') = any (v_bases)))
      and ST_DWithin(a.geom, v_lines, p_buffer_m + 200)
  ),
  cx as materialized (
    -- one row per address (a complex = all its units)
    select civic_no, civic_suffix, street_norm, street_name, street_type, street_dir,
           count(*) as n,
           count(distinct nullif(trim(unit), '')) as units,
           count(distinct (round(lat::numeric, 5), round(lng::numeric, 5))) as spots,
           avg(lat) as lat, avg(lng) as lng
    from cand
    group by civic_no, civic_suffix, street_norm, street_name, street_type, street_dir
  ),
  mine as materialized (
    -- addresses on THIS route's stretch of their street (by the address's middle)
    select cx.*, (cx.units >= 4 and cx.spots >= cx.units * 0.8) as split
    from cx, lateral (select ST_SetSRID(ST_MakePoint(cx.lng, cx.lat), 4326) as p) pt
    where ST_DWithin(pt.p::geography, v_lines, p_buffer_m)
      and ((v_private is not null and ST_DWithin(pt.p::geography, v_private, p_buffer_m))   -- on the route's private roads
           or route_street_hit(p_route_code, cx.street_norm, pt.p, true)
           or (route_street_hit(p_route_code, cx.street_norm, pt.p, false)
               and not other_route_street_hit(p_route_code, cx.street_norm, pt.p)))
  ),
  ins_whole as (
    insert into route_houses (route_code, house_key, civic_no, civic_suffix,
                              street_name, street_norm, unit_count, lat, lng, source)
    select p_route_code,
           house_key(m.civic_no, m.civic_suffix, m.street_norm),
           m.civic_no, m.civic_suffix,
           trim(concat_ws(' ', initcap(m.street_name), initcap(lower(m.street_type)), upper(m.street_dir))),
           m.street_norm, m.n::int, m.lat, m.lng, 'nar'
    from mine m
    where not m.split
    on conflict (route_code, house_key) do update
      set unit_count = excluded.unit_count, lat = excluded.lat, lng = excluded.lng, updated_at = now()
      where route_houses.source = 'nar' and route_houses.geo_source is null
    returning 1
  ),
  ins_units as (
    insert into route_houses (route_code, house_key, civic_no, civic_suffix,
                              street_name, street_norm, unit_count, lat, lng, source, unit)
    select p_route_code,
           c.civic_no::text || lower(coalesce(c.civic_suffix, '')) || '#' || lower(trim(c.unit)) || '|' || c.street_norm,
           c.civic_no, c.civic_suffix,
           trim(concat_ws(' ', initcap(c.street_name), initcap(lower(c.street_type)), upper(c.street_dir))),
           c.street_norm, 1, avg(c.lat), avg(c.lng), 'nar', upper(trim(c.unit))
    from cand c
    join mine m on m.split
               and m.civic_no = c.civic_no
               and m.civic_suffix is not distinct from c.civic_suffix
               and m.street_norm = c.street_norm
               and m.street_name is not distinct from c.street_name
               and m.street_type is not distinct from c.street_type
               and m.street_dir is not distinct from c.street_dir
    where nullif(trim(c.unit), '') is not null
    group by c.civic_no, c.civic_suffix, c.street_norm, c.street_name, c.street_type, c.street_dir, upper(trim(c.unit)), lower(trim(c.unit))
    on conflict (route_code, house_key) do update
      set lat = excluded.lat, lng = excluded.lng, updated_at = now()
      where route_houses.source = 'nar' and route_houses.geo_source is null
    returning 1
  ),
  gone_knocks as (
    -- a split complex: its old whole-complex knock can't be pinned to a unit
    delete from house_dispositions d
    using mine m
    where m.split and d.route_code = p_route_code
      and d.house_key = house_key(m.civic_no, m.civic_suffix, m.street_norm)
    returning 1
  ),
  gone as (
    delete from route_houses r
    using mine m
    where m.split and r.route_code = p_route_code
      and r.house_key = house_key(m.civic_no, m.civic_suffix, m.street_norm)
      and r.unit is null and r.source <> 'manual'
    returning 1
  )
  select (select count(*) from ins_whole) + (select count(*) from ins_units)
       + (select count(*) from gone_knocks) + (select count(*) from gone)
    into v_x;

  select count(*) into v_count from route_houses where route_code = p_route_code;
  if v_count > 0 then
    insert into route_house_builds (route_code, built_at, source, house_count)
    values (p_route_code, now(), 'nar', v_count)
    on conflict (route_code) do update
      set built_at = now(), source = 'nar', house_count = excluded.house_count;
  end if;
  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.load_route_street_lines_batch(p_n integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_codes text[];
begin
  select array_agg(route_code) into v_codes from (
    select distinct rm.route_code from route_maps rm
    where rm.status = 'approved'
      and not exists (select 1 from route_street_lines_loaded d where d.route_code = rm.route_code)
    order by rm.route_code
    limit p_n
  ) r;
  if v_codes is null then return 0; end if;

  delete from route_street_lines where route_code = any (v_codes);
  insert into route_street_lines (route_code, street_norm, street_base, line, zone)
  select x.route_code, x.street_norm, regexp_replace(x.street_norm, '\s+\S+$', ''), x.line,
         ST_Union(ST_Buffer(x.line, 60, 'endcap=flat')::geometry, ST_Buffer(x.line, 12)::geometry)
  from (
    select rm.route_code,
           norm_street(s.seg->>'name') as street_norm,
           ST_MakeLine(array(
             select ST_SetSRID(ST_MakePoint((c->>0)::float8, (c->>1)::float8), 4326)
             from jsonb_array_elements(s.seg->'coordinates') with ordinality as t(c, ord)
             order by ord))::geography as line
    from route_maps rm, jsonb_array_elements(rm.segments) as s(seg)
    where rm.route_code = any (v_codes)
      and rm.status = 'approved'
      and jsonb_array_length(s.seg->'coordinates') >= 2
      and norm_street(s.seg->>'name') is not null
  ) x;
  insert into route_street_lines_loaded (route_code) select unnest(v_codes) on conflict do nothing;
  return array_length(v_codes, 1);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clean_routes_batch(p_n integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; v_k integer := 0;
begin
  for r in
    select b.route_code from route_house_builds b
    where not exists (select 1 from route_cleanup_pass p where p.route_code = b.route_code)
    order by b.route_code
    limit p_n
  loop
    insert into route_cleanup_pass (route_code, removed) values (r.route_code, cleanup_route_ghosts(r.route_code))
    on conflict (route_code) do nothing;
    v_k := v_k + 1;
  end loop;
  return v_k;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cleanup_route_ghosts(p_route_code text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_keys   text[];
  v_strays text[];
  v_total  integer;
  v_n      integer := 0;
  v_private geography;
begin
  -- The route's unnamed lines: private roads of complexes drawn into the route.
  select ST_Union(l.line)::geography
    into v_private
  from (
    select ST_MakeLine(
             ST_SetSRID(ST_MakePoint((c->>0)::float8, (c->>1)::float8), 4326)
             order by ord
           ) as line
    from route_maps rm,
         jsonb_array_elements(rm.segments) with ordinality as s(seg, sord),
         jsonb_array_elements(s.seg->'coordinates') with ordinality as t(c, ord)
    where rm.route_code = p_route_code
      and rm.status = 'approved'
      and coalesce(trim(s.seg->>'name'), '') = ''
    group by rm.id, s.sord
    having count(*) >= 2
  ) l;

  -- 1. Ghosts: OpenStreetMap-only addresses that are in neither the register
  --    nor the city's list, and that Mapbox couldn't place (with any knock).
  select array_agg(rh.house_key) into v_keys
  from route_houses rh
  where rh.route_code = p_route_code
    and rh.source = 'osm'
    and rh.geo_source is null
    and rh.geocoded_at is not null
    and not exists (select 1 from nar_addresses a
                    where a.civic_no = rh.civic_no and a.street_norm = rh.street_norm)
    and not exists (select 1 from town_address_points c
                    where c.civic_no::text = rh.civic_no::text and c.street_norm = rh.street_norm);
  if v_keys is not null then
    delete from house_dispositions where route_code = p_route_code and house_key = any (v_keys);
    delete from route_houses where route_code = p_route_code and house_key = any (v_keys);
    v_n := array_length(v_keys, 1);
  end if;

  -- 2. Strays: houses on ANOTHER route's stretch of their street and not on
  --    this route's. Kept: hand-added houses, houses with a knock.
  select array_agg(rh.house_key) into v_strays
  from route_houses rh
  where rh.route_code = p_route_code
    and rh.source <> 'manual'
    and rh.unit is null                       -- condo units: the builder decides by the complex
    and not (v_private is not null                -- on the route's own private roads
             and ST_DWithin(ST_SetSRID(ST_MakePoint(rh.lng, rh.lat), 4326)::geography, v_private, 60))
    and not exists (select 1 from house_dispositions d
                    where d.route_code = p_route_code and d.house_key = rh.house_key)
    and not route_street_hit(p_route_code, rh.street_norm, ST_SetSRID(ST_MakePoint(rh.lng, rh.lat), 4326), true)
    and other_route_street_hit(p_route_code, rh.street_norm, ST_SetSRID(ST_MakePoint(rh.lng, rh.lat), 4326));
  select count(*) into v_total from route_houses where route_code = p_route_code;
  -- Safety: if it would remove more than half the route, something else is
  -- wrong (e.g. the route map is missing streets) — remove nothing.
  if v_strays is not null and array_length(v_strays, 1) * 2 <= v_total then
    delete from route_houses where route_code = p_route_code and house_key = any (v_strays);
    v_n := v_n + array_length(v_strays, 1);
  end if;

  if v_n > 0 then
    update route_house_builds
       set house_count = (select count(*) from route_houses where route_code = p_route_code)
     where route_code = p_route_code;
  end if;
  return v_n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_route_house_positions(p_route_code text, p_items jsonb, p_done boolean DEFAULT false, p_note text DEFAULT NULL::text, p_tried jsonb DEFAULT '[]'::jsonb, p_release boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n integer;
begin
  update route_houses rh
     set lat = (i->>'lat')::float8,
         lng = (i->>'lng')::float8,
         geo_source = 'mapbox',
         geo_accuracy = i->>'accuracy',
         geocoded_at = now(),
         updated_at = now()
    from jsonb_array_elements(p_items) as i
   where rh.route_code = p_route_code
     and rh.house_key = i->>'houseKey'
     and i->>'accuracy' = 'rooftop';
  get diagnostics v_n = row_count;

  -- Non-rooftop answers: keep the register point, just mark the house as asked.
  update route_houses rh
     set geocoded_at = now()
    from jsonb_array_elements(p_items) as i
   where rh.route_code = p_route_code
     and rh.house_key = i->>'houseKey'
     and coalesce(i->>'accuracy', '') <> 'rooftop'
     and rh.geo_source is null;

  update route_houses rh
     set geocoded_at = now()
   where rh.route_code = p_route_code
     and rh.geo_source is null
     and rh.house_key in (select jsonb_array_elements_text(coalesce(p_tried, '[]'::jsonb)));

  if p_done then
    update route_house_builds
       set geocoded_at = now(), geocode_note = p_note
     where route_code = p_route_code;
  else
    update route_house_builds
       set geocode_started_at = case when p_release then null else now() end,
           geocode_note = coalesce(p_note, geocode_note)
     where route_code = p_route_code
       and geocoded_at is null;
  end if;
  return v_n;
end;
$function$
;


-- generated columns (need functions above)
alter table public.building_footprints add column if not exists geom geometry(Polygon,4326) generated always as (st_geomfromtext(wkt, 4326)) stored;
alter table public.nar_addresses add column if not exists street_norm text generated always as (norm_street(((((COALESCE(street_name, ''::text) || ' '::text) || COALESCE(street_type, ''::text)) || ' '::text) || COALESCE(street_dir, ''::text)))) stored;
alter table public.nar_addresses add column if not exists geom geography(Point,4326) generated always as ((st_setsrid(st_makepoint(lng, lat), 4326))::geography) stored;
CREATE INDEX nar_addresses_geom_idx ON public.nar_addresses USING gist (geom);
CREATE INDEX nar_addresses_street_norm_idx ON public.nar_addresses USING btree (street_norm);
CREATE INDEX building_footprints_geom_idx ON public.building_footprints USING gist (geom);

-- views
create or replace view public.geography_columns as
 SELECT current_database() AS f_table_catalog,
    n.nspname AS f_table_schema,
    c.relname AS f_table_name,
    a.attname AS f_geography_column,
    postgis_typmod_dims(a.atttypmod) AS coord_dimension,
    postgis_typmod_srid(a.atttypmod) AS srid,
    postgis_typmod_type(a.atttypmod) AS type
   FROM pg_class c,
    pg_attribute a,
    pg_type t,
    pg_namespace n
  WHERE ((t.typname = 'geography'::name) AND (a.attisdropped = false) AND (a.atttypid = t.oid) AND (a.attrelid = c.oid) AND (c.relnamespace = n.oid) AND (c.relkind = ANY (ARRAY['r'::"char", 'v'::"char", 'm'::"char", 'f'::"char", 'p'::"char"])) AND (NOT pg_is_other_temp_schema(c.relnamespace)) AND has_table_privilege(c.oid, 'SELECT'::text));

create or replace view public.geometry_columns as
 SELECT (current_database())::character varying(256) AS f_table_catalog,
    n.nspname AS f_table_schema,
    c.relname AS f_table_name,
    a.attname AS f_geometry_column,
    COALESCE(postgis_typmod_dims(a.atttypmod), sn.ndims, 2) AS coord_dimension,
    COALESCE(NULLIF(postgis_typmod_srid(a.atttypmod), 0), sr.srid, 0) AS srid,
    (replace(replace(COALESCE(NULLIF(upper(postgis_typmod_type(a.atttypmod)), 'GEOMETRY'::text), st.type, 'GEOMETRY'::text), 'ZM'::text, ''::text), 'Z'::text, ''::text))::character varying(30) AS type
   FROM ((((((pg_class c
     JOIN pg_attribute a ON (((a.attrelid = c.oid) AND (NOT a.attisdropped))))
     JOIN pg_namespace n ON ((c.relnamespace = n.oid)))
     JOIN pg_type t ON ((a.atttypid = t.oid)))
     LEFT JOIN ( SELECT s.connamespace,
            s.conrelid,
            s.conkey,
            replace(split_part(s.consrc, ''''::text, 2), ')'::text, ''::text) AS type
           FROM ( SELECT pg_constraint.connamespace,
                    pg_constraint.conrelid,
                    pg_constraint.conkey,
                    pg_get_constraintdef(pg_constraint.oid) AS consrc
                   FROM pg_constraint) s
          WHERE (s.consrc ~~* '%geometrytype(% = %'::text)) st ON (((st.connamespace = n.oid) AND (st.conrelid = c.oid) AND (a.attnum = ANY (st.conkey)))))
     LEFT JOIN ( SELECT s.connamespace,
            s.conrelid,
            s.conkey,
            (replace(split_part(s.consrc, ' = '::text, 2), ')'::text, ''::text))::integer AS ndims
           FROM ( SELECT pg_constraint.connamespace,
                    pg_constraint.conrelid,
                    pg_constraint.conkey,
                    pg_get_constraintdef(pg_constraint.oid) AS consrc
                   FROM pg_constraint) s
          WHERE (s.consrc ~~* '%ndims(% = %'::text)) sn ON (((sn.connamespace = n.oid) AND (sn.conrelid = c.oid) AND (a.attnum = ANY (sn.conkey)))))
     LEFT JOIN ( SELECT s.connamespace,
            s.conrelid,
            s.conkey,
            (replace(replace(split_part(s.consrc, ' = '::text, 2), ')'::text, ''::text), '('::text, ''::text))::integer AS srid
           FROM ( SELECT pg_constraint.connamespace,
                    pg_constraint.conrelid,
                    pg_constraint.conkey,
                    pg_get_constraintdef(pg_constraint.oid) AS consrc
                   FROM pg_constraint) s
          WHERE (s.consrc ~~* '%srid(% = %'::text)) sr ON (((sr.connamespace = n.oid) AND (sr.conrelid = c.oid) AND (a.attnum = ANY (sr.conkey)))))
  WHERE ((c.relkind = ANY (ARRAY['r'::"char", 'v'::"char", 'm'::"char", 'f'::"char", 'p'::"char"])) AND (NOT (c.relname = 'raster_columns'::name)) AND (t.typname = 'geometry'::name) AND (NOT pg_is_other_temp_schema(c.relnamespace)) AND has_table_privilege(c.oid, 'SELECT'::text));


-- triggers
CREATE TRIGGER trigger_job_fair_applicants_updated_at BEFORE UPDATE ON public.job_fair_applicants FOR EACH ROW EXECUTE FUNCTION update_job_fair_applicant_updated_at();
CREATE TRIGGER trg_route_splits_updated_at BEFORE UPDATE ON public.route_splits FOR EACH ROW EXECUTE FUNCTION route_splits_set_updated_at();
CREATE TRIGGER route_maps_lines AFTER INSERT OR DELETE OR UPDATE ON public.route_maps FOR EACH ROW EXECUTE FUNCTION route_maps_lines_trigger();


-- row level security
alter table public.job_fair_sessions enable row level security;
alter table public.job_fair_applicants enable row level security;
alter table public.campaigns enable row level security;
alter table public.dialer_sessions enable row level security;
alter table public.campaign_managers enable row level security;
alter table public.pcl_cache enable row level security;
alter table public.nar_addresses_position_backup enable row level security;
alter table public.dialer_presence enable row level security;
alter table public.town_load_progress enable row level security;
alter table public.route_maps enable row level security;
alter table public.campaign_books enable row level security;
alter table public.area_prefixes enable row level security;
alter table public.workerbook_confirmations enable row level security;
alter table public.gallery_steps enable row level security;
alter table public.map_logsheet_cc_access enable row level security;
alter table public.building_footprints enable row level security;
alter table public.worker_pcl_templates enable row level security;
alter table public.map_logsheet_access enable row level security;
alter table public.route_street_lines enable row level security;
alter table public.route_street_lines_loaded enable row level security;
alter table public.route_cleanup_pass enable row level security;
alter table public.town_address_points enable row level security;
alter table public.route_street_checks enable row level security;
alter table public.house_dispositions enable row level security;
alter table public.route_house_builds enable row level security;
alter table public.route_houses enable row level security;
alter table public.nar_addresses enable row level security;
create policy "Allow all operations for authenticated" on public.job_fair_sessions as PERMISSIVE for ALL to public using (true);
create policy "Allow public to read sessions for validation" on public.job_fair_sessions as PERMISSIVE for SELECT to public using ((status = 'active'::text));
create policy "Allow all operations for authenticated on applicants" on public.job_fair_applicants as PERMISSIVE for ALL to public using (true);
create policy "Allow public to insert applicants" on public.job_fair_applicants as PERMISSIVE for INSERT to public with check (true);
create policy "Allow all for anon - campaigns" on public.campaigns as PERMISSIVE for ALL to anon using (true) with check (true);
create policy "Allow all for anon - dialer_sessions" on public.dialer_sessions as PERMISSIVE for ALL to anon using (true) with check (true);
create policy "Allow all for anon - campaign_managers" on public.campaign_managers as PERMISSIVE for ALL to anon using (true) with check (true);
create policy "Allow all on pcl_cache" on public.pcl_cache as PERMISSIVE for ALL to public using (true) with check (true);
create policy "Allow all for authenticated" on public.dialer_presence as PERMISSIVE for ALL to public using (true) with check (true);
create policy "Allow all" on public.route_maps as PERMISSIVE for ALL to public using (true);
create policy "Allow all access to campaign_books" on public.campaign_books as PERMISSIVE for ALL to public using (true) with check (true);
create policy "Allow all" on public.area_prefixes as PERMISSIVE for ALL to public using (true);
create policy "Public can insert confirmations" on public.workerbook_confirmations as PERMISSIVE for INSERT to public with check (true);
create policy "Public can read confirmations" on public.workerbook_confirmations as PERMISSIVE for SELECT to public using (true);
create policy "Public can update synced flag" on public.workerbook_confirmations as PERMISSIVE for UPDATE to public using (true);
create policy "gallery_steps app all" on public.gallery_steps as PERMISSIVE for ALL to anon, authenticated using (true) with check (true);
create policy "map_logsheet_cc_access app all" on public.map_logsheet_cc_access as PERMISSIVE for ALL to anon, authenticated using (true) with check (true);
create policy "building_footprints read" on public.building_footprints as PERMISSIVE for SELECT to anon, authenticated using (true);
create policy worker_pcl_templates_all on public.worker_pcl_templates as PERMISSIVE for ALL to public using (true) with check (true);
create policy "map_logsheet_access app all" on public.map_logsheet_access as PERMISSIVE for ALL to anon, authenticated using (true) with check (true);
create policy route_street_lines_read on public.route_street_lines as PERMISSIVE for SELECT to public using (true);
create policy route_street_checks_read on public.route_street_checks as PERMISSIVE for SELECT to public using (true);
create policy house_dispositions_all on public.house_dispositions as PERMISSIVE for ALL to public using (true) with check (true);
create policy route_house_builds_all on public.route_house_builds as PERMISSIVE for ALL to public using (true) with check (true);
create policy route_houses_all on public.route_houses as PERMISSIVE for ALL to public using (true) with check (true);
create policy nar_addresses_read on public.nar_addresses as PERMISSIVE for SELECT to public using (true);


-- storage buckets
insert into storage.buckets (id, name, public) values ('logos', 'logos', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('training-images', 'training-images', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('trainingvids', 'trainingvids', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('master-maps', 'master-maps', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('gallery', 'gallery', true) on conflict (id) do nothing;

reset check_function_bodies;
-- Payslips in the new app. ADDITIVE ONLY.
--
--   payout_lines   one row per worker per finalized cart per day — the same numbers the old
--                  app wrote to the "Payout Stats" sheet, saved when a day is closed (or built
--                  from the saved copy of an already-closed day)
--   payslip_runs   one "Generate payslips" for a date range at a center
--   payslips       one per worker in a run: the day lines, the extras (hotels, advances,
--                  travel package, crackfill %, extra deductions/additions, $120 program),
--                  earned and final pay. Generated → Paid (signed off in the app), or Void.
--
-- A day line can be on one live payslip only; voiding a payslip frees its lines again.
-- Reading needs Workerbook at the center; every write goes through the functions below.

create table if not exists public.payout_lines (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.command_centers(id) on delete restrict,
  day date not null,
  cn text not null,
  hire_id uuid references public.hires(id) on delete set null,
  first_name text not null default '',
  last_name text not null default '',
  manager text,
  steps numeric not null default 0,
  equiv numeric not null default 0,
  total_prepay numeric not null default 0,
  payout_rate numeric not null default 0,
  aer_comm numeric not null default 0,
  upsell_comm numeric not null default 0,
  mach_rent numeric not null default 0,
  deductions numeric not null default 0,
  daily_bonus numeric not null default 0,
  total_payout numeric not null default 0,
  indiv_gross numeric not null default 0,
  crackfill_base numeric not null default 0,
  stats jsonb not null default '{}',
  payslip_id uuid,
  created_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists payout_lines_center_day on public.payout_lines (center_id, day);
create index if not exists payout_lines_payslip on public.payout_lines (payslip_id);

create table if not exists public.payslip_runs (
  id uuid primary key default gen_random_uuid(),
  center_id uuid not null references public.command_centers(id) on delete restrict,
  start_day date not null,
  end_day date not null,
  season text not null check (season in ('aeration', 'cleaning', 'sealing')),
  hidden jsonb not null default '{}',
  created_by uuid,
  created_at timestamptz not null default now(),
  check (end_day >= start_day)
);
create index if not exists payslip_runs_center on public.payslip_runs (center_id, created_at desc);

create table if not exists public.payslips (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.payslip_runs(id) on delete restrict,
  center_id uuid not null references public.command_centers(id) on delete restrict,
  cn text not null,
  hire_id uuid references public.hires(id) on delete set null,
  first_name text not null default '',
  last_name text not null default '',
  batch text,
  settings jsonb not null default '{}',
  days jsonb not null default '[]',
  earned numeric not null default 0,
  final_pay numeric not null default 0,
  status text not null default 'generated' check (status in ('generated', 'paid', 'void')),
  generated_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid,
  voided_at timestamptz,
  voided_by uuid
);
create index if not exists payslips_run on public.payslips (run_id);
do $$ begin
  alter table public.payout_lines add constraint payout_lines_payslip_fk foreign key (payslip_id) references public.payslips(id) on delete set null;
exception when duplicate_object then null; end $$;
create index if not exists payslips_center_status on public.payslips (center_id, status);

alter table public.payout_lines enable row level security;
alter table public.payslip_runs enable row level security;
alter table public.payslips enable row level security;
drop policy if exists payout_lines_read on public.payout_lines;
create policy payout_lines_read on public.payout_lines for select to authenticated
  using (app_has_perm('workerbook') and app_can_see_center(center_id));
drop policy if exists payslip_runs_read on public.payslip_runs;
create policy payslip_runs_read on public.payslip_runs for select to authenticated
  using (app_has_perm('workerbook') and app_can_see_center(center_id));
drop policy if exists payslips_read on public.payslips;
create policy payslips_read on public.payslips for select to authenticated
  using (app_has_perm('workerbook') and app_can_see_center(center_id));
revoke all on public.payout_lines, public.payslip_runs, public.payslips from anon, authenticated;
grant select on public.payout_lines, public.payslip_runs, public.payslips to authenticated;

-- ───────────── day lines ─────────────

-- Save a day's lines (replacing that day's lines not yet on a payslip).
-- p_lines: [{cn, first_name, last_name, manager, steps, equiv, total_prepay, payout_rate, aer_comm,
--            upsell_comm, mach_rent, deductions, daily_bonus, total_payout, indiv_gross, crackfill_base, stats}]
create or replace function public.app_save_payout_lines(p_center uuid, p_day date, p_lines jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (app_has_perm('workerbook') and app_can_see_center(p_center)) then raise exception 'Not allowed'; end if;
  if exists (select 1 from payout_lines l join payslips s on s.id = l.payslip_id
              where l.center_id = p_center and l.day = p_day and s.status <> 'void') then
    raise exception 'Some of % is already on a payslip; void that payslip first to rebuild the day', p_day;
  end if;
  delete from payout_lines where center_id = p_center and day = p_day;
  insert into payout_lines (center_id, day, cn, hire_id, first_name, last_name, manager, steps, equiv, total_prepay, payout_rate,
                            aer_comm, upsell_comm, mach_rent, deductions, daily_bonus, total_payout, indiv_gross, crackfill_base, stats, created_by)
  select p_center, p_day, upper(trim(x->>'cn')),
         (select h.id from hires h where lower(h.cn) = lower(trim(x->>'cn')) and h.year = extract(year from p_day)::int limit 1),
         coalesce(x->>'first_name', ''), coalesce(x->>'last_name', ''), nullif(x->>'manager', ''),
         coalesce((x->>'steps')::numeric, 0), coalesce((x->>'equiv')::numeric, 0), coalesce((x->>'total_prepay')::numeric, 0),
         coalesce((x->>'payout_rate')::numeric, 0), coalesce((x->>'aer_comm')::numeric, 0), coalesce((x->>'upsell_comm')::numeric, 0),
         coalesce((x->>'mach_rent')::numeric, 0), coalesce((x->>'deductions')::numeric, 0), coalesce((x->>'daily_bonus')::numeric, 0),
         coalesce((x->>'total_payout')::numeric, 0), coalesce((x->>'indiv_gross')::numeric, 0), coalesce((x->>'crackfill_base')::numeric, 0),
         coalesce(x->'stats', '{}'::jsonb), auth.uid()
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
   where coalesce(trim(x->>'cn'), '') <> '';
  get diagnostics n = row_count;
  return n;
end $$;

-- Days kept in the saved copy (archive) that have no payout lines yet, newest first.
create or replace function public.app_payout_line_gaps(p_center uuid)
returns table (day date, carts int) language sql stable security definer set search_path = public as $$
  select a.day, count(*)::int
    from archive.session_rows a
   where a.center_id = p_center and a.source_table = 'logsheet_sessions'
     and app_has_perm('workerbook') and app_can_see_center(p_center)
     and not exists (select 1 from payout_lines l where l.center_id = p_center and l.day = a.day)
   group by a.day
   order by a.day desc
   limit 60
$$;

-- The saved copy of a closed day, to rebuild its payout lines in the browser (same maths).
create or replace function public.app_archived_day(p_center uuid, p_day date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (app_has_perm('workerbook') and app_can_see_center(p_center)) then raise exception 'Not allowed'; end if;
  return jsonb_build_object(
    'daily_session', (select row_data from archive.session_rows where center_id = p_center and day = p_day and source_table = 'daily_sessions' limit 1),
    'sessions', coalesce((select jsonb_agg(row_data) from archive.session_rows where center_id = p_center and day = p_day and source_table = 'logsheet_sessions'), '[]'::jsonb),
    'transactions', coalesce((select jsonb_agg(row_data) from archive.session_rows where center_id = p_center and day = p_day and source_table = 'transactions'), '[]'::jsonb),
    'users', coalesce((select jsonb_agg(row_data) from archive.session_rows where center_id = p_center and day = p_day and source_table = 'users'), '[]'::jsonb));
end $$;

-- ───────────── payslips ─────────────

-- Save a run of payslips. p_slips: [{cn, first_name, last_name, batch, settings, days, line_ids[], earned, final_pay}]
create or replace function public.app_generate_payslips(
  p_center uuid, p_start date, p_end date, p_season text, p_hidden jsonb, p_slips jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  run uuid;
  x jsonb;
  slip uuid;
  ids uuid[];
  ok int;
begin
  if not (app_has_perm('workerbook') and app_can_see_center(p_center)) then raise exception 'Not allowed'; end if;
  if jsonb_array_length(coalesce(p_slips, '[]'::jsonb)) = 0 then raise exception 'No payslips to generate'; end if;
  insert into payslip_runs (center_id, start_day, end_day, season, hidden, created_by)
  values (p_center, p_start, p_end, p_season, coalesce(p_hidden, '{}'::jsonb), auth.uid()) returning id into run;

  for x in select * from jsonb_array_elements(p_slips) loop
    select coalesce(array_agg(v::uuid), '{}') into ids from jsonb_array_elements_text(coalesce(x->'line_ids', '[]'::jsonb)) v;
    select count(*) into ok from payout_lines
     where id = any(ids) and center_id = p_center and day between p_start and p_end and payslip_id is null;
    if ok <> cardinality(ids) or ok = 0 then
      raise exception 'Some days for % are already on another payslip or outside the dates; refresh and try again', x->>'cn';
    end if;
    insert into payslips (run_id, center_id, cn, hire_id, first_name, last_name, batch, settings, days, earned, final_pay)
    values (run, p_center, upper(x->>'cn'),
            (select hire_id from payout_lines where id = ids[1]),
            coalesce(x->>'first_name', ''), coalesce(x->>'last_name', ''), nullif(x->>'batch', ''),
            coalesce(x->'settings', '{}'::jsonb), coalesce(x->'days', '[]'::jsonb),
            coalesce((x->>'earned')::numeric, 0), coalesce((x->>'final_pay')::numeric, 0))
    returning id into slip;
    update payout_lines set payslip_id = slip where id = any(ids);
  end loop;
  return run;
end $$;

-- Sign off: mark generated payslips paid (who and when are recorded).
create or replace function public.app_payslips_mark_paid(p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not app_has_perm('workerbook') then raise exception 'Not allowed'; end if;
  if exists (select 1 from payslips where id = any(p_ids) and not app_can_see_center(center_id)) then raise exception 'Not allowed'; end if;
  update payslips set status = 'paid', paid_at = now(), paid_by = auth.uid()
   where id = any(p_ids) and status = 'generated';
  get diagnostics n = row_count;
  return n;
end $$;

-- Void a payslip that hasn't been paid; its days can go on a new one.
create or replace function public.app_payslip_void(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s payslips;
begin
  select * into s from payslips where id = p_id for update;
  if s.id is null then raise exception 'Payslip not found'; end if;
  if not (app_has_perm('workerbook') and app_can_see_center(s.center_id)) then raise exception 'Not allowed'; end if;
  if s.status = 'paid' then raise exception 'This payslip is already paid and can''t be voided'; end if;
  update payslips set status = 'void', voided_at = now(), voided_by = auth.uid() where id = p_id;
  update payout_lines set payslip_id = null where payslip_id = p_id;
end $$;

revoke all on function public.app_save_payout_lines(uuid, date, jsonb) from public, anon;
revoke all on function public.app_payout_line_gaps(uuid) from public, anon;
revoke all on function public.app_archived_day(uuid, date) from public, anon;
revoke all on function public.app_generate_payslips(uuid, date, date, text, jsonb, jsonb) from public, anon;
revoke all on function public.app_payslips_mark_paid(uuid[]) from public, anon;
revoke all on function public.app_payslip_void(uuid) from public, anon;
grant execute on function public.app_save_payout_lines(uuid, date, jsonb) to authenticated;
grant execute on function public.app_payout_line_gaps(uuid) to authenticated;
grant execute on function public.app_archived_day(uuid, date) to authenticated;
grant execute on function public.app_generate_payslips(uuid, date, date, text, jsonb, jsonb) to authenticated;
grant execute on function public.app_payslips_mark_paid(uuid[]) to authenticated;
grant execute on function public.app_payslip_void(uuid) to authenticated;

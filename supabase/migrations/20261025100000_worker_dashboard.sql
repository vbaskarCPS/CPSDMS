-- RUN_23 — the worker dashboard, and payslips workers can see and you can edit. ADDITIVE ONLY:
-- adds a table and two columns; replaces app_save_payout_lines and app_save_payout_day (same
-- inputs; a day on a payslip that's only Generated can now be changed), app_generate_payslips
-- (same, and safe against two people generating at once), app_worker_set_pin and
-- app_reset_worker_pin (same, and they end dashboard passes); adds the rest.
--
-- SIGNING IN ANY TIME. A worker signs in with their CN # and PIN (or first name until they make a
-- PIN) against this year's contractor list (hires), not today's session list, so it works when no
-- session is running. Anyone on the list can, except a contractor marked Quit (Q) or Fired (F).
-- Five wrong PINs lock that CN for 15 minutes. Signing in gives the phone a private pass (a long
-- random code; only its hash is kept here) that lasts 30 days. Every dashboard call checks the
-- pass. Passes end when the contractor is marked Quit or Fired, when the PIN is made or changed
-- (other phones are signed out), and when a manager clears the PIN.
--
-- PAYSLIPS FOR THE WORKER. A worker sees their own Generated and Paid payslips (never a void one),
-- exactly as saved, through their pass.
--
-- EDITING A GENERATED PAYSLIP. Extras, batch and which of the worker's unpaid days are on it can
-- be changed; the day rows, earned and final pay are worked out again here from the day lines
-- (the same sums as the payslip PDF). Fixing a day in Payouts while its payslip is only Generated
-- updates that payslip the same way.
--
-- PAID IS LOCKED. A paid payslip, and the day lines on it, can't be changed or voided by anything,
-- including direct database writes from the app (triggers below).

-- ───────────── passes ─────────────
create table if not exists public.worker_passes (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  hire_id uuid not null references public.hires(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  last_seen_at timestamptz
);
create index if not exists worker_passes_hire on public.worker_passes (hire_id);
alter table public.worker_passes enable row level security;
revoke all on public.worker_passes from anon, authenticated;

alter table public.payslips
  add column if not exists updated_at timestamptz,
  add column if not exists updated_by uuid;

-- this year, in Toronto
create or replace function public.worker_this_year()
returns int language sql stable set search_path = public as $$
  select extract(year from (now() at time zone 'America/Toronto'))::int
$$;

-- Is this the worker's PIN (or first name, until they have a PIN)? Wrong PINs are counted; five
-- lock the CN for 15 minutes. Never raises, so the count is never rolled back.
create or replace function public.worker_check_hire_secret(p_hire uuid, p_secret text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare h hires; first text; ok boolean; fails int;
begin
  -- locked, so tries in parallel can't each read the same count
  select * into h from hires where id = p_hire for update;
  if h.id is null or coalesce(trim(p_secret), '') = '' then return false; end if;
  if h.pin_hash is null then
    -- no PIN yet: the first name on the contractor list, or the one today's session was loaded with
    select first_name into first from people where id = h.person_id;
    return (lower(trim(coalesce(first, ''))) <> '' and lower(trim(coalesce(first, ''))) = lower(trim(p_secret)))
        or exists (select 1 from users u where u.role = 'Worker' and lower(u.user_id) = lower(h.cn)
                    and coalesce(u.password, '') <> '' and lower(trim(u.password)) = lower(trim(p_secret)));
  end if;
  if h.pin_locked_until is not null and h.pin_locked_until > now() then return false; end if;
  ok := crypt(p_secret, h.pin_hash) = h.pin_hash;
  fails := case when h.pin_locked_until is not null then 0 else h.pin_failed end;
  update hires
     set pin_failed = case when ok then 0 else fails + 1 end,
         pin_locked_until = case when ok then null when fails + 1 >= 5 then now() + interval '15 minutes' else null end
   where id = h.id;
  return ok;
end $$;
revoke all on function public.worker_check_hire_secret(uuid, text) from public, anon, authenticated;

-- The contractor a pass belongs to, if the pass is good and they may still sign in.
create or replace function public.worker_pass_hire(p_token text)
returns public.hires language plpgsql security definer set search_path = public, extensions as $$
declare h hires; v_pass uuid;
begin
  if coalesce(p_token, '') = '' then return null; end if;
  select p.id into v_pass from worker_passes p
   where p.token_hash = encode(digest(p_token, 'sha256'), 'hex') and p.expires_at > now();
  if v_pass is null then return null; end if;
  select x.* into h from hires x where x.id = (select hire_id from worker_passes where id = v_pass);
  if h.id is null or h.status in ('Q', 'F') or h.year <> worker_this_year() then return null; end if;
  update worker_passes set last_seen_at = now() where id = v_pass and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
  return h;
end $$;
revoke all on function public.worker_pass_hire(text) from public, anon, authenticated;

-- What the dashboard shows about the worker.
create or replace function public.worker_profile(h public.hires)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'hire_id', h.id, 'cn', h.cn, 'year', h.year, 'status', h.status,
    'first_name', p.first_name, 'last_name', p.last_name,
    'center_id', h.center_id, 'center_name', c.display_name, 'region', c.region, 'services', c.services,
    'has_pin', h.pin_hash is not null)
    from people p, command_centers c
   where p.id = h.person_id and c.id = h.center_id
$$;
revoke all on function public.worker_profile(public.hires) from public, anon, authenticated;

-- ───────────── sign in / out ─────────────
create or replace function public.app_worker_sign_in(p_cn text, p_secret text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare h hires; v_token text;
begin
  select * into h from hires where lower(cn) = lower(trim(coalesce(p_cn, ''))) and year = worker_this_year() limit 1;
  if h.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if h.pin_locked_until is not null and h.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'until', h.pin_locked_until);
  end if;
  if not worker_check_hire_secret(h.id, p_secret) then
    select * into h from hires where id = h.id;
    return jsonb_build_object('ok', false, 'reason', case when h.pin_locked_until > now() then 'locked' else 'wrong' end,
                              'until', h.pin_locked_until, 'has_pin', h.pin_hash is not null);
  end if;
  -- the right secret, but no longer on the list
  if h.status in ('Q', 'F') then return jsonb_build_object('ok', false, 'reason', 'left'); end if;
  delete from worker_passes where expires_at < now();
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into worker_passes (token_hash, hire_id) values (encode(digest(v_token, 'sha256'), 'hex'), h.id);
  return jsonb_build_object('ok', true, 'token', v_token, 'expires_at', now() + interval '30 days', 'worker', worker_profile(h));
end $$;

create or replace function public.app_worker_sign_out(p_token text)
returns void language sql volatile security definer set search_path = public, extensions as $$
  delete from worker_passes where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

-- The worker, and whether they're on a session that's running now (their old-app row for it,
-- so the app can open today's logsheet without asking for the PIN again).
create or replace function public.app_worker_me(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare h hires; v_today jsonb;
begin
  h := worker_pass_hire(p_token);
  if h.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  select to_jsonb(u) - 'password' into v_today
    from users u
   where u.role = 'Worker' and lower(u.user_id) = lower(h.cn)
     and exists (select 1 from daily_sessions d where d.command_center_id = u.command_center_id and d.is_active)
   order by (u.command_center_id = coalesce(h.current_center_id, h.center_id)) desc
   limit 1;
  return jsonb_build_object('ok', true, 'worker', worker_profile(h), 'today', v_today);
end $$;

-- ───────────── the worker's payslips ─────────────
create or replace function public.app_worker_payslips(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare h hires;
begin
  h := worker_pass_hire(p_token);
  if h.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  return jsonb_build_object('ok', true, 'payslips', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', s.id, 'cn', s.cn, 'first_name', s.first_name, 'last_name', s.last_name,
             'start_day', r.start_day, 'end_day', r.end_day, 'season', r.season, 'hidden', r.hidden,
             'center_name', c.display_name, 'settings', s.settings, 'days', s.days,
             'earned', s.earned, 'final_pay', s.final_pay, 'status', s.status,
             'generated_at', s.generated_at, 'updated_at', s.updated_at, 'paid_at', s.paid_at)
           order by r.start_day desc, s.generated_at desc), '[]')
      from payslips s join payslip_runs r on r.id = s.run_id join command_centers c on c.id = s.center_id
     where s.status in ('generated', 'paid')
       and (s.hire_id = h.id
            or (s.hire_id is null and upper(s.cn) = upper(h.cn) and s.center_id = h.center_id and extract(year from r.start_day)::int = h.year))));
end $$;

-- The day lines on one of the worker's payslips, with everything each day's pay was worked out
-- from (steps, money collected by payment type, product cost, EQ, rate parts, bonuses …). Totals
-- only: no customer names or addresses are kept on a day line.
create or replace function public.app_worker_payslip_lines(p_token text, p_payslip uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare h hires; s payslips; r payslip_runs;
begin
  h := worker_pass_hire(p_token);
  if h.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  select * into s from payslips where id = p_payslip and status in ('generated', 'paid');
  if s.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into r from payslip_runs where id = s.run_id;
  if not (s.hire_id = h.id or (s.hire_id is null and upper(s.cn) = upper(h.cn) and s.center_id = h.center_id and extract(year from r.start_day)::int = h.year)) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'tax_rate', (select tax_rate from command_centers where id = s.center_id), 'lines', (
    select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'day', l.day, 'manager', l.manager, 'steps', l.steps, 'equiv', l.equiv,
             'payout_rate', l.payout_rate, 'total_payout', l.total_payout, 'stats', l.stats) order by l.day, l.created_at, l.id), '[]')
      from payout_lines l where l.payslip_id = s.id));
end $$;

-- ───────────── the worker's account (PIN, phones, email) through the pass ─────────────
create or replace function public.app_worker_pass_account(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare h hires; p people;
begin
  h := worker_pass_hire(p_token);
  if h.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  select * into p from people where id = h.person_id;
  return jsonb_build_object('ok', true, 'cn', h.cn, 'name', trim(p.first_name || ' ' || p.last_name),
    'has_pin', h.pin_hash is not null, 'pin_set_at', h.pin_set_at,
    'cell_phone', p.cell_phone, 'alt_phone', p.alt_phone, 'email', p.email);
end $$;

create or replace function public.app_worker_pass_save_account(p_token text, p_cell text, p_alt text, p_email text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare h hires;
  cell text := nullif(trim(coalesce(p_cell, '')), '');
  alt text := nullif(trim(coalesce(p_alt, '')), '');
  mail text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  h := worker_pass_hire(p_token);
  if h.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if cell is not null and length(regexp_replace(cell, '\D', '', 'g')) not between 10 and 11 then return jsonb_build_object('ok', false, 'reason', 'bad_phone'); end if;
  if alt is not null and length(regexp_replace(alt, '\D', '', 'g')) not between 10 and 11 then return jsonb_build_object('ok', false, 'reason', 'bad_phone'); end if;
  if mail is not null and mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('ok', false, 'reason', 'bad_email'); end if;
  update people set cell_phone = cell, alt_phone = alt, email = mail, updated_at = now() where id = h.person_id;
  -- today's old-app row too (what managers see in Contacts)
  update users set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('phone', coalesce(cell, ''))
   where role = 'Worker' and lower(user_id) = lower(h.cn);
  return jsonb_build_object('ok', true);
end $$;

-- Create or change the PIN (4 to 6 digits); the current PIN (or first name) is asked again.
create or replace function public.app_worker_pass_set_pin(p_token text, p_current text, p_new_pin text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare h hires;
begin
  h := worker_pass_hire(p_token);
  if h.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if h.pin_locked_until is not null and h.pin_locked_until > now() then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  if not worker_check_hire_secret(h.id, p_current) then return jsonb_build_object('ok', false, 'reason', 'wrong'); end if;
  if coalesce(p_new_pin, '') !~ '^\d{4,6}$' then return jsonb_build_object('ok', false, 'reason', 'bad_pin'); end if;
  update hires set pin_hash = crypt(p_new_pin, gen_salt('bf')), pin_set_at = now(), pin_failed = 0, pin_locked_until = null where id = h.id;
  -- every other phone signed in as this worker is signed out
  delete from worker_passes where hire_id = h.id and token_hash <> encode(digest(p_token, 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end $$;

-- A PIN made from the logsheet menu, or cleared by a manager, signs out every dashboard pass.
create or replace function public.app_worker_set_pin(p_contractor_id text, p_center uuid, p_secret text, p_new_pin text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  u users;
  h hires;
begin
  select * into u from users
   where role = 'Worker' and lower(user_id) = lower(p_contractor_id) and command_center_id = p_center
   limit 1;
  if u.user_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not app_worker_check_secret(u, p_secret) then return jsonb_build_object('ok', false, 'reason', 'wrong'); end if;
  if coalesce(p_new_pin, '') !~ '^\d{4,6}$' then return jsonb_build_object('ok', false, 'reason', 'bad_pin'); end if;
  h := app_worker_hire_for(u.user_id, p_center);
  if h.id is null then return jsonb_build_object('ok', false, 'reason', 'no_record'); end if;
  update hires
     set pin_hash = crypt(p_new_pin, gen_salt('bf')), pin_set_at = now(), pin_failed = 0, pin_locked_until = null
   where id = h.id;
  delete from worker_passes where hire_id = h.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.app_reset_worker_pin(p_hire uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  select center_id into c from hires where id = p_hire;
  if c is null then raise exception 'Contractor not found'; end if;
  if not (app_has_perm('workerbook') and app_can_see_center(c)) then raise exception 'Not allowed'; end if;
  update hires set pin_hash = null, pin_set_at = null, pin_failed = 0, pin_locked_until = null where id = p_hire;
  delete from worker_passes where hire_id = p_hire;
end $$;

-- Marked Quit or Fired: their passes end (and stay ended if they're later put back).
create or replace function public.worker_passes_end_on_leave()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('Q', 'F') and old.status is distinct from new.status then delete from worker_passes where hire_id = new.id; end if;
  return new;
end $$;
drop trigger if exists hires_end_worker_passes on public.hires;
create trigger hires_end_worker_passes after update of status on public.hires for each row execute function public.worker_passes_end_on_leave();

-- ───────────── a payslip worked out from its day lines (same sums as the payslip PDF) ─────────────
create or replace function public.payslip_r2(x numeric)
returns numeric language sql immutable set search_path = public as $$
  -- the PDF rounds with Math.round(x * 100) / 100: halves go up
  select round(floor(coalesce(x, 0) * 100 + 0.5) / 100, 2)
$$;

-- One day line as the payslip prints it ("Oct07", manager, steps … crackfill base).
create or replace function public.payslip_day_row(l public.payout_lines)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'date', to_char(l.day, 'Mon') || to_char(l.day, 'DD'), 'manager', coalesce(l.manager, ''),
    'steps', l.steps, 'equiv', l.equiv, 'totalPrepay', l.total_prepay, 'payoutRate', l.payout_rate,
    'aerComm', l.aer_comm, 'upsellComm', l.upsell_comm, 'machRent', l.mach_rent, 'deductions', l.deductions,
    'dailyBonus', l.daily_bonus, 'totalPayout', l.total_payout, 'indivGross', l.indiv_gross, 'crackfillBase', l.crackfill_base)
$$;

-- Rebuild a Generated payslip's days, earned and final pay from the day lines on it (voided when
-- no day is left on it).
create or replace function public.payslip_refresh(p_id uuid, p_by uuid)
returns void language plpgsql security definer set search_path = public as $$
declare s payslips; r payslip_runs; v_days jsonb; v_n int; v_earned numeric; v_gi numeric; st jsonb; hid jsonb; v_final numeric;
begin
  select * into s from payslips where id = p_id for update;
  if s.id is null or s.status <> 'generated' then return; end if;
  select * into r from payslip_runs where id = s.run_id;
  select coalesce(jsonb_agg(payslip_day_row(l) order by l.day, l.created_at, l.id), '[]'), count(*), payslip_r2(coalesce(sum(l.total_payout), 0))
    into v_days, v_n, v_earned from payout_lines l where l.payslip_id = p_id;
  -- every day taken off (e.g. the worker removed from their only day): nothing left to pay
  if v_n = 0 then
    update payslips set status = 'void', voided_at = now(), voided_by = p_by, updated_at = now(), updated_by = p_by where id = p_id;
    return;
  end if;
  st := coalesce(s.settings, '{}'); hid := coalesce(r.hidden, '{}');
  v_gi := case when coalesce((st->>'is120Program')::boolean, false) then payslip_r2(greatest(v_earned, v_n * 120)) else v_earned end;
  v_final := payslip_r2(v_gi
    - case when coalesce((hid->>'hotels')::boolean, false) then 0 else coalesce((st->>'hotels')::numeric, 0) end
    - case when coalesce((hid->>'advances')::boolean, false) then 0 else coalesce((st->>'advances')::numeric, 0) end
    - case when coalesce((hid->>'travelPkg')::boolean, false) then 0 else coalesce((st->>'travelPkg')::numeric, 0) end
    - case when r.season = 'sealing' then payslip_r2(v_earned * coalesce((st->>'crackfillPct')::numeric, 0) / 100) else 0 end
    - coalesce((select sum(coalesce((x->>'amount')::numeric, 0)) from jsonb_array_elements(coalesce(st->'extraDeductions', '[]')) x), 0)
    + coalesce((select sum(coalesce((x->>'amount')::numeric, 0)) from jsonb_array_elements(coalesce(st->'additions', '[]')) x), 0));
  if s.days is distinct from v_days or s.earned is distinct from v_earned or s.final_pay is distinct from v_final then
    update payslips set days = v_days, earned = v_earned, final_pay = v_final, updated_at = now(), updated_by = p_by where id = p_id;
  end if;
end $$;
revoke all on function public.payslip_refresh(uuid, uuid) from public, anon, authenticated;

-- Edit a Generated payslip: its extras, batch, and which of the worker's unpaid days are on it.
create or replace function public.app_payslip_update(p_id uuid, p_settings jsonb, p_batch text, p_line_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare s payslips; r payslip_runs; v_bad int;
begin
  select * into s from payslips where id = p_id for update;
  if s.id is null then raise exception 'Payslip not found'; end if;
  if not (app_has_perm('workerbook') and app_can_see_center(s.center_id)) then raise exception 'Not allowed'; end if;
  if s.status = 'paid' then raise exception 'This payslip is paid, so it''s locked'; end if;
  if s.status <> 'generated' then raise exception 'This payslip was voided'; end if;
  if coalesce(cardinality(p_line_ids), 0) = 0 then raise exception 'A payslip needs at least one day. To take every day off, void it.'; end if;
  select * into r from payslip_runs where id = s.run_id;
  -- every day must be this worker's, at this center, in the pay period, and on this payslip or on none
  select count(*) into v_bad from unnest(p_line_ids) x(id)
   where not exists (select 1 from payout_lines l where l.id = x.id and l.center_id = s.center_id and upper(l.cn) = upper(s.cn)
                       and l.day between r.start_day and r.end_day and (l.payslip_id is null or l.payslip_id = p_id));
  if v_bad > 0 then raise exception 'Some of those days aren''t this worker''s unpaid days in % – %; refresh and try again', r.start_day, r.end_day; end if;
  update payout_lines set payslip_id = null where payslip_id = p_id and not (id = any(p_line_ids));
  update payout_lines set payslip_id = p_id where id = any(p_line_ids) and payslip_id is null;
  update payslips set settings = coalesce(p_settings, settings), batch = nullif(trim(coalesce(p_batch, '')), ''), updated_at = now(), updated_by = auth.uid()
   where id = p_id;
  perform payslip_refresh(p_id, auth.uid());
  return (select jsonb_build_object('earned', earned, 'final_pay', final_pay, 'days', jsonb_array_length(days)) from payslips where id = p_id);
end $$;

-- ───────────── a day on a Generated payslip can be changed; a Paid one can't ─────────────
create or replace function public.app_save_payout_lines(p_center uuid, p_day date, p_lines jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int; v_map jsonb; v_slips uuid[];
begin
  if not (app_has_perm('workerbook') and app_can_see_center(p_center)) then raise exception 'Not allowed'; end if;
  -- the day's payslips can't be signed off or edited while the day is being saved
  perform 1 from payslips where id in (select payslip_id from payout_lines where center_id = p_center and day = p_day) order by id for update;
  if exists (select 1 from payout_lines l join payslips s on s.id = l.payslip_id
              where l.center_id = p_center and l.day = p_day and s.status = 'paid') then
    raise exception '% is on a paid payslip, so it''s locked', p_day;
  end if;
  select coalesce(array_agg(distinct l.payslip_id), '{}') into v_slips
    from payout_lines l join payslips s on s.id = l.payslip_id
   where l.center_id = p_center and l.day = p_day and s.status = 'generated';
  -- a worker with carts on different payslips that day (or only some on one) can't be sorted out
  -- again from the new lines: that payslip is fixed first
  if exists (select 1 from payout_lines l where l.center_id = p_center and l.day = p_day
              group by upper(l.cn) having count(distinct coalesce(l.payslip_id::text, '-')) > 1) then
    raise exception 'On %, % has carts on a payslip and carts not on it (or on two payslips). Edit that payslip so all of their carts that day are on it, or none, then save the day.',
      p_day, (select string_agg(cn, ', ') from (select upper(l.cn) cn from payout_lines l where l.center_id = p_center and l.day = p_day
                                                 group by upper(l.cn) having count(distinct coalesce(l.payslip_id::text, '-')) > 1) z);
  end if;
  -- each worker whose day is on a Generated payslip: their new lines go back onto it
  select coalesce(jsonb_object_agg(cn, payslip_id), '{}') into v_map from (
    select upper(l.cn) as cn, min(l.payslip_id::text)::uuid as payslip_id
      from payout_lines l join payslips s on s.id = l.payslip_id
     where l.center_id = p_center and l.day = p_day and s.status = 'generated'
     group by upper(l.cn)) z;

  delete from payout_lines where center_id = p_center and day = p_day;
  insert into payout_lines (center_id, day, cn, hire_id, first_name, last_name, manager, steps, equiv, total_prepay, payout_rate,
                            aer_comm, upsell_comm, mach_rent, deductions, daily_bonus, total_payout, indiv_gross, crackfill_base, stats, created_by, payslip_id)
  select p_center, p_day, upper(trim(x->>'cn')),
         (select h.id from hires h where lower(h.cn) = lower(trim(x->>'cn')) and h.year = extract(year from p_day)::int limit 1),
         coalesce(x->>'first_name', ''), coalesce(x->>'last_name', ''), nullif(x->>'manager', ''),
         coalesce((x->>'steps')::numeric, 0), coalesce((x->>'equiv')::numeric, 0), coalesce((x->>'total_prepay')::numeric, 0),
         coalesce((x->>'payout_rate')::numeric, 0), coalesce((x->>'aer_comm')::numeric, 0), coalesce((x->>'upsell_comm')::numeric, 0),
         coalesce((x->>'mach_rent')::numeric, 0), coalesce((x->>'deductions')::numeric, 0), coalesce((x->>'daily_bonus')::numeric, 0),
         coalesce((x->>'total_payout')::numeric, 0), coalesce((x->>'indiv_gross')::numeric, 0), coalesce((x->>'crackfill_base')::numeric, 0),
         coalesce(x->'stats', '{}'::jsonb), auth.uid(),
         (v_map->>upper(trim(x->>'cn')))::uuid
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x
   where coalesce(trim(x->>'cn'), '') <> '';
  get diagnostics n = row_count;
  perform payslip_refresh(id, auth.uid()) from unnest(v_slips) id;
  return n;
end $$;

create or replace function public.app_save_payout_day(p_center uuid, p_day date, p_carts jsonb, p_lines jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  c jsonb;
  ci bigint;
  cart_id uuid;
  n int;
begin
  if not (app_has_perm('workerbook') and app_can_see_center(p_center)) then raise exception 'Not allowed'; end if;
  if exists (select 1 from payout_lines l join payslips s on s.id = l.payslip_id
              where l.center_id = p_center and l.day = p_day and s.status = 'paid') then
    raise exception '% is on a paid payslip, so it''s locked.', p_day;
  end if;
  if not exists (select 1 from days where center_id = p_center and day = p_day and state in ('live', 'closed')) then
    raise exception 'There''s no session on % to save payouts for', p_day;
  end if;

  delete from payout_carts where center_id = p_center and day = p_day;   -- sales go with them
  for c, ci in select x, o from jsonb_array_elements(coalesce(p_carts, '[]'::jsonb)) with ordinality t(x, o) loop
    insert into payout_carts (center_id, day, sort, label, manager, members, eq_override, crackfill_lbs, bonuses, settings, notes, source, finalized, created_by, updated_by)
    values (p_center, p_day, ci, coalesce(c->>'label', ''), nullif(c->>'manager', ''), coalesce(c->'members', '[]'::jsonb),
            nullif(c->>'eq_override', '')::numeric, coalesce(nullif(c->>'crackfill_lbs', '')::numeric, 0),
            coalesce(c->'bonuses', '[]'::jsonb), coalesce(c->'settings', '{}'::jsonb), nullif(c->>'notes', ''),
            coalesce(c->>'source', 'edited'), coalesce((c->>'finalized')::boolean, true), auth.uid(), auth.uid())
    returning id into cart_id;
    insert into payout_sales (cart_id, center_id, day, sort, route_code, address, client_name, price, payment_type, payments, type, display_price, service, notes, meta)
    select cart_id, p_center, p_day, so, nullif(s->>'route_code', ''), nullif(s->>'address', ''), nullif(s->>'client_name', ''),
           coalesce(nullif(s->>'price', '')::numeric, 0), coalesce(nullif(s->>'payment_type', ''), 'Cash'),
           case when jsonb_typeof(s->'payments') = 'object' then s->'payments' end,
           coalesce(nullif(s->>'type', ''), 'Sale'), nullif(s->>'display_price', ''), nullif(s->>'service', ''), nullif(s->>'notes', ''),
           coalesce(s->'meta', '{}'::jsonb)
      from jsonb_array_elements(coalesce(c->'sales', '[]'::jsonb)) with ordinality u(s, so);
  end loop;

  n := app_save_payout_lines(p_center, p_day, p_lines);
  return n;
end $$;

-- Generate (same as before), but a day taken by another payslip in the meantime stops the run.
create or replace function public.app_generate_payslips(
  p_center uuid, p_start date, p_end date, p_season text, p_hidden jsonb, p_slips jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  run uuid;
  x jsonb;
  slip uuid;
  ids uuid[];
  ok int;
  n int;
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
    update payout_lines set payslip_id = slip where id = any(ids) and payslip_id is null;
    get diagnostics n = row_count;
    if n <> cardinality(ids) then raise exception 'Some days for % were just put on another payslip; refresh and try again', x->>'cn'; end if;
  end loop;
  return run;
end $$;

-- ───────────── paid is locked, whatever writes ─────────────
create or replace function public.payslip_paid_lock()
returns trigger language plpgsql set search_path = public as $$
begin
  -- a contractor record deleted later only clears the link to it
  if (to_jsonb(new) - 'hire_id') = (to_jsonb(old) - 'hire_id') then return new; end if;
  if old.status = 'paid' then raise exception 'A paid payslip can''t be changed'; end if;
  return new;
end $$;
drop trigger if exists payslips_paid_lock on public.payslips;
create trigger payslips_paid_lock before update on public.payslips for each row execute function public.payslip_paid_lock();

create or replace function public.payout_line_paid_lock()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'hire_id') = (to_jsonb(old) - 'hire_id') then return new; end if;
  if tg_op in ('UPDATE', 'DELETE') and old.payslip_id is not null and exists (select 1 from payslips where id = old.payslip_id and status = 'paid') then
    raise exception 'That day is on a paid payslip, so it''s locked';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.payslip_id is not null and exists (select 1 from payslips where id = new.payslip_id and status = 'paid') then
    raise exception 'A paid payslip can''t take more days';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists payout_lines_paid_lock on public.payout_lines;
create trigger payout_lines_paid_lock before insert or update or delete on public.payout_lines for each row execute function public.payout_line_paid_lock();

-- ───────────── who may call what ─────────────
do $$
declare f text;
begin
  foreach f in array array['app_worker_sign_in(text, text)', 'app_worker_sign_out(text)', 'app_worker_me(text)', 'app_worker_payslips(text)',
    'app_worker_payslip_lines(text, uuid)',
    'app_worker_set_pin(text, uuid, text, text)',
    'app_worker_pass_account(text)', 'app_worker_pass_save_account(text, text, text, text)', 'app_worker_pass_set_pin(text, text, text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  foreach f in array array['app_payslip_update(uuid, jsonb, text, uuid[])', 'app_save_payout_lines(uuid, date, jsonb)', 'app_save_payout_day(uuid, date, jsonb, jsonb)',
    'app_generate_payslips(uuid, date, date, text, jsonb, jsonb)', 'app_reset_worker_pin(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

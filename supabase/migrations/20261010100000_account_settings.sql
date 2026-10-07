-- Account settings from the dashboards. ADDITIVE ONLY.
--
--   Managers  update their own phone and email (their password already changes through
--             Supabase Auth on /app/password). The phone is also copied onto today's
--             old-app manager row, which is what workers see in Contacts.
--   Workers   from the map logsheet menu: confirm it's them (PIN, or first name until they
--             have one), then update their phones and email and create or change a PIN.
--   Sign-in   once a worker has a PIN, the old app's worker sign-in takes the PIN instead of
--             the first name. Five wrong PINs in a row lock that worker for 15 minutes.
--   Staff     with Workerbook can clear a forgotten PIN (back to first name).
--
-- The PIN is stored only as a bcrypt hash (hires.pin_hash, never readable from the app).
-- Wrong attempts are counted without raising errors, so the count is never rolled back.

alter table public.hires
  add column if not exists pin_failed int not null default 0,
  add column if not exists pin_locked_until timestamptz;

-- ───────────── internal helpers (not callable from the app) ─────────────

-- The hire behind an old-app worker row: same CN at the same center, latest year.
create or replace function public.app_worker_hire_for(p_cn text, p_center uuid)
returns public.hires language sql stable security definer set search_path = public as $$
  select h.* from hires h
   where lower(h.cn) = lower(p_cn) and h.center_id = p_center
   order by h.year desc limit 1
$$;

-- Does this secret prove it's this worker? PIN when one is set, else the old first-name password.
create or replace function public.app_worker_check_secret(p_user public.users, p_secret text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare
  h hires;
  ok boolean;
  fails int;
begin
  if coalesce(p_secret, '') = '' then return false; end if;
  h := app_worker_hire_for(p_user.user_id, p_user.command_center_id);
  if h.id is null or h.pin_hash is null then
    return lower(coalesce(p_user.password, '')) = lower(p_secret);
  end if;
  if h.pin_locked_until is not null and h.pin_locked_until > now() then return false; end if;
  ok := crypt(p_secret, h.pin_hash) = h.pin_hash;
  -- a lock that has run out starts the count again
  fails := case when h.pin_locked_until is not null then 0 else h.pin_failed end;
  update hires
     set pin_failed = case when ok then 0 else fails + 1 end,
         pin_locked_until = case when ok then null
                                 when fails + 1 >= 5 then now() + interval '15 minutes'
                                 else null end
   where id = h.id;
  return ok;
end $$;

revoke all on function public.app_worker_hire_for(text, uuid) from public, anon, authenticated;
revoke all on function public.app_worker_check_secret(public.users, text) from public, anon, authenticated;

-- ───────────── worker sign-in (old app) ─────────────
-- Same inputs and result as before; a worker with a PIN signs in with it.
create or replace function public.legacy_login_worker(p_contractor_id text, p_password text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  u users;
  hits jsonb[] := '{}';
begin
  if coalesce(p_password, '') = '' then return null; end if;
  for u in select * from users where role = 'Worker' and lower(user_id) = lower(p_contractor_id) loop
    if app_worker_check_secret(u, p_password) then
      hits := hits || (to_jsonb(u) - 'password');
    end if;
  end loop;
  if coalesce(array_length(hits, 1), 0) = 1 then return hits[1]; end if;
  return null;
end $$;

revoke all on function public.legacy_login_worker(text, text) from public;
grant execute on function public.legacy_login_worker(text, text) to anon, authenticated;

-- ───────────── worker account (from the map logsheet) ─────────────

-- The worker's own details, once they've confirmed it's them. { ok:false, reason } otherwise.
create or replace function public.app_worker_account(p_contractor_id text, p_center uuid, p_secret text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  u users;
  h hires;
  p people;
begin
  select * into u from users
   where role = 'Worker' and lower(user_id) = lower(p_contractor_id) and command_center_id = p_center
   limit 1;
  if u.user_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  h := app_worker_hire_for(u.user_id, p_center);
  if h.pin_locked_until is not null and h.pin_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'until', h.pin_locked_until);
  end if;
  if not app_worker_check_secret(u, p_secret) then
    return jsonb_build_object('ok', false, 'reason', 'wrong');
  end if;
  if h.id is not null then select * into p from people where id = h.person_id; end if;
  return jsonb_build_object(
    'ok', true,
    'cn', u.user_id,
    'name', u.name,
    'has_record', h.id is not null,
    'has_pin', h.pin_hash is not null,
    'pin_set_at', h.pin_set_at,
    'cell_phone', coalesce(p.cell_phone, u.metadata->>'phone'),
    'alt_phone', p.alt_phone,
    'email', p.email
  );
end $$;

-- Save the worker's phones and email. Also updates today's old-app row (what managers see).
create or replace function public.app_worker_save_account(
  p_contractor_id text, p_center uuid, p_secret text, p_cell text, p_alt text, p_email text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  u users;
  h hires;
  cell text := nullif(trim(coalesce(p_cell, '')), '');
  alt text := nullif(trim(coalesce(p_alt, '')), '');
  mail text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  select * into u from users
   where role = 'Worker' and lower(user_id) = lower(p_contractor_id) and command_center_id = p_center
   limit 1;
  if u.user_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if not app_worker_check_secret(u, p_secret) then return jsonb_build_object('ok', false, 'reason', 'wrong'); end if;
  if cell is not null and length(regexp_replace(cell, '\D', '', 'g')) not between 10 and 11 then
    return jsonb_build_object('ok', false, 'reason', 'bad_phone');
  end if;
  if alt is not null and length(regexp_replace(alt, '\D', '', 'g')) not between 10 and 11 then
    return jsonb_build_object('ok', false, 'reason', 'bad_phone');
  end if;
  if mail is not null and mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return jsonb_build_object('ok', false, 'reason', 'bad_email');
  end if;
  h := app_worker_hire_for(u.user_id, p_center);
  if h.id is not null then
    update people set cell_phone = cell, alt_phone = alt, email = mail, updated_at = now() where id = h.person_id;
  end if;
  update users set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('phone', coalesce(cell, ''))
   where role = 'Worker' and lower(user_id) = lower(u.user_id) and command_center_id = p_center;
  return jsonb_build_object('ok', true);
end $$;

-- Create or change the worker's PIN (4 to 6 digits).
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
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.app_worker_account(text, uuid, text) from public;
revoke all on function public.app_worker_save_account(text, uuid, text, text, text, text) from public;
revoke all on function public.app_worker_set_pin(text, uuid, text, text) from public;
grant execute on function public.app_worker_account(text, uuid, text) to anon, authenticated;
grant execute on function public.app_worker_save_account(text, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.app_worker_set_pin(text, uuid, text, text) to anon, authenticated;

-- ───────────── staff: clear a forgotten PIN ─────────────
create or replace function public.app_reset_worker_pin(p_hire uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  select center_id into c from hires where id = p_hire;
  if c is null then raise exception 'Contractor not found'; end if;
  if not (app_has_perm('workerbook') and app_can_see_center(c)) then raise exception 'Not allowed'; end if;
  update hires set pin_hash = null, pin_set_at = null, pin_failed = 0, pin_locked_until = null where id = p_hire;
end $$;
revoke all on function public.app_reset_worker_pin(uuid) from public, anon;
grant execute on function public.app_reset_worker_pin(uuid) to authenticated;

-- ───────────── manager: own phone and email ─────────────
create or replace function public.app_update_my_contact(p_phone text, p_email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  me app_users;
  ph text := nullif(trim(coalesce(p_phone, '')), '');
  mail text := nullif(lower(trim(coalesce(p_email, ''))), '');
begin
  select * into me from app_users where id = auth.uid() and is_active;
  if me.id is null then raise exception 'Not signed in'; end if;
  if ph is not null and length(regexp_replace(ph, '\D', '', 'g')) not between 10 and 11 then
    raise exception 'Enter a 10-digit phone number';
  end if;
  if mail is not null and mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  update app_users set phone = ph, email = mail, updated_at = now() where id = me.id;
  -- today's old-app manager row (workers see this number in Contacts)
  update users set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('phone', coalesce(ph, ''))
   where role = 'RouteManager' and user_id = 'rm_' || regexp_replace(lower(me.full_name), '[^a-z0-9]', '', 'g');
end $$;
revoke all on function public.app_update_my_contact(text, text) from public, anon;
grant execute on function public.app_update_my_contact(text, text) to authenticated;

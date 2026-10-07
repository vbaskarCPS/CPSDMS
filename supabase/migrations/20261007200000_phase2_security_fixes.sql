-- Phase 2 · urgent security fixes (additive; the old app keeps working).
--
-- 1. Card data: card numbers and CVCs are never stored. Bambora live payments
--    keep their safe reference (BAMBORA-<id>, auth code, last 4). Any other
--    card entry is cut down to its last 4 digits by a trigger, and the cards
--    already stored are blanked the same way.
-- 2. Logins are checked inside the database by legacy_login_* functions, and an
--    update can no longer blank a stored password.
--
-- Order: run this part A, deploy the app, then run part B
-- (20261007200100_phase2_hide_passwords.sql), which hides the password columns.
-- Part A changes nothing the current app relies on.

-- ───────────────────────── 1. card data ─────────────────────────
create or replace function public.transactions_strip_card_data()
returns trigger language plpgsql set search_path = public as $$
declare digits text;
begin
  if new.cc_full_number is null or new.cc_full_number like 'BAMBORA-%' then
    return new;  -- nothing stored, or a Bambora reference (auth code + last 4, no card data)
  end if;
  if new.cc_full_number like 'CARD-%' then
    new.cc_expiry := null; new.cc_cvc := null;
    return new;
  end if;
  digits := regexp_replace(new.cc_full_number, '\D', '', 'g');
  new.cc_full_number := case when length(digits) >= 4 then 'CARD-••••' || right(digits, 4) end;
  new.cc_expiry := null;
  new.cc_cvc := null;
  return new;
end $$;

drop trigger if exists strip_card_data on public.transactions;
create trigger strip_card_data before insert or update on public.transactions
  for each row execute function public.transactions_strip_card_data();

-- Blank the cards already stored (the trigger does the masking).
update public.transactions set cc_full_number = cc_full_number
 where cc_full_number is not null and cc_full_number not like 'BAMBORA-%';
update public.transactions set cc_cvc = null, cc_expiry = null
 where cc_full_number is null and (cc_cvc is not null or cc_expiry is not null);

-- ───────────────────────── 2. logins checked in the database ─────────────────────────
-- Same matching as before (case-insensitive where the old query used ilike),
-- but as plain comparisons so '%' and '_' can't act as wildcards. Each returns
-- the row without its password, or null.

create or replace function public.legacy_login_center(p_username text, p_password text)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(c) - 'password' from command_centers c
   where c.username = p_username and c.password = p_password and coalesce(p_password, '') <> ''
   limit 1
$$;

create or replace function public.legacy_login_rm(p_username text, p_password text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when count(*) = 1 then (array_agg(to_jsonb(u) - 'password'))[1] end
    from users u
   where u.role = 'RouteManager' and lower(u.username) = lower(p_username)
     and lower(u.password) = lower(p_password) and coalesce(p_password, '') <> ''
$$;

create or replace function public.legacy_login_worker(p_contractor_id text, p_password text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when count(*) = 1 then (array_agg(to_jsonb(u) - 'password'))[1] end
    from users u
   where u.role = 'Worker' and lower(u.user_id) = lower(p_contractor_id)
     and lower(u.password) = lower(p_password) and coalesce(p_password, '') <> ''
$$;

-- Returns a list, like the old query did.
create or replace function public.legacy_login_campaign_manager(p_rep_code text, p_password text)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(m) - 'password' from campaign_managers m
   where lower(m.rep_code) = lower(p_rep_code) and m.password = p_password and coalesce(p_password, '') <> ''
$$;

revoke all on function public.legacy_login_center(text, text) from public;
revoke all on function public.legacy_login_rm(text, text) from public;
revoke all on function public.legacy_login_worker(text, text) from public;
revoke all on function public.legacy_login_campaign_manager(text, text) from public;
grant execute on function public.legacy_login_center(text, text) to anon, authenticated;
grant execute on function public.legacy_login_rm(text, text) to anon, authenticated;
grant execute on function public.legacy_login_worker(text, text) to anon, authenticated;
grant execute on function public.legacy_login_campaign_manager(text, text) to anon, authenticated;

-- An upsert that doesn't carry a password (because the app can no longer read
-- it) must not wipe the one that's stored.
create or replace function public.keep_password_if_blank()
returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(new.password, '') = '' and coalesce(old.password, '') <> '' then
    new.password := old.password;
  end if;
  return new;
end $$;

drop trigger if exists keep_password on public.users;
create trigger keep_password before update on public.users
  for each row execute function public.keep_password_if_blank();
drop trigger if exists keep_password on public.command_centers;
create trigger keep_password before update on public.command_centers
  for each row execute function public.keep_password_if_blank();
drop trigger if exists keep_password on public.campaign_managers;
create trigger keep_password before update on public.campaign_managers
  for each row execute function public.keep_password_if_blank();

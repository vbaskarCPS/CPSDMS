-- RUN_62 — MainstreetAI reps sign in with their email only. No username anywhere they see it.
--
--   Hidden sign-in address   a rep's login address becomes rep-<id>@reps.cpsdms.app, not <username>@login…,
--                            so their username can't be used to sign in on the Manager or Worker tab. Set
--                            when someone becomes a rep (and put back if they stop being one). Their email
--                            reaches it only through the rep-auth function (ms_rep_login_address).
--   Rep code                 the code on their send-info links (?ref=…) is made from their name, e.g. VIJAYB,
--                            unique; an admin can change it (ms_admin_set_rep_code). Was the username.
--   Setup page               ms_setup_rep_email(code): a rep's setup link gives the page their email, so it
--                            can sign them in by email straight after they choose their password.
-- Additive: a column, functions and triggers. The internal username stays (the account system needs it), unseen.

alter table public.app_users add column if not exists rep_code text;
create unique index if not exists app_users_rep_code on public.app_users (upper(rep_code)) where rep_code is not null;

-- the hidden address for a rep, and the username one for everyone else
create or replace function public.ms_rep_hidden_login(p_user uuid)
returns text language sql immutable as $$ select 'rep-' || replace(p_user::text, '-', '') || '@reps.cpsdms.app' $$;

create or replace function public.ms_set_login_address(p_user uuid, p_rep boolean)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_addr text;
begin
  if p_rep then v_addr := ms_rep_hidden_login(p_user);
  else select username || '@login.cpsdms.app' into v_addr from app_users where id = p_user;
  end if;
  if v_addr is null then return; end if;
  update auth.users set email = v_addr, updated_at = now() where id = p_user and email is distinct from v_addr;
  update auth.identities set identity_data = identity_data || jsonb_build_object('email', v_addr), updated_at = now()
   where user_id = p_user and provider = 'email' and identity_data->>'email' is distinct from v_addr;
end $$;
revoke all on function public.ms_set_login_address(uuid, boolean) from public, anon, authenticated;

-- a code from the name: first name + first letter of the last, letters only, up to 10, then a number if taken
create or replace function public.ms_make_rep_code(p_name text, p_user uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := regexp_split_to_array(upper(trim(coalesce(p_name, ''))), '\s+');
  base text := left(regexp_replace(coalesce(parts[1], ''), '[^A-Z]', '', 'g'), 8)
               || left(regexp_replace(coalesce(parts[array_length(parts, 1)], ''), '[^A-Z]', '', 'g'), case when array_length(parts, 1) > 1 then 1 else 0 end);
  v text; n int := 1;
begin
  if length(base) < 2 then base := 'REP'; end if;
  v := base;
  while exists (select 1 from app_users where upper(rep_code) = v and id <> p_user) loop
    n := n + 1; v := base || n;
  end loop;
  return v;
end $$;
revoke all on function public.ms_make_rep_code(text, uuid) from public, anon, authenticated;

-- becoming a rep (or not)
create or replace function public.ms_rep_login_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.permission = 'mainstreet_rep' then
    perform ms_set_login_address(new.user_id, true);
    update app_users set rep_code = ms_make_rep_code(full_name, id) where id = new.user_id and rep_code is null;
  elsif tg_op = 'DELETE' and old.permission = 'mainstreet_rep' then
    perform ms_set_login_address(old.user_id, false);
  end if;
  return null;
end $$;
drop trigger if exists ms_rep_login_sync on public.user_permissions;
create trigger ms_rep_login_sync after insert or delete on public.user_permissions
  for each row execute function public.ms_rep_login_sync();

-- the reps there are now
do $$
declare r record;
begin
  for r in select up.user_id, u.full_name from user_permissions up join app_users u on u.id = up.user_id where up.permission = 'mainstreet_rep' loop
    perform ms_set_login_address(r.user_id, true);
    update app_users set rep_code = ms_make_rep_code(r.full_name, r.user_id) where id = r.user_id and rep_code is null;
  end loop;
end $$;

-- sign in by email: the rep's hidden address (service role only, for rep-auth)
create or replace function public.ms_rep_login_address(p_email text)
returns text language sql stable security definer set search_path = public, auth as $$
  select au.email
    from app_users u
    join user_permissions up on up.user_id = u.id and up.permission = 'mainstreet_rep'
    join auth.users au on au.id = u.id
   where lower(u.email) = lower(trim(coalesce(p_email, ''))) and u.is_active
   limit 1
$$;
revoke all on function public.ms_rep_login_address(text) from public, anon, authenticated;

-- a rep's setup link: their email (the page signs them in with it). Nothing for anyone else's link.
create or replace function public.ms_setup_rep_email(p_code text)
returns text language sql stable security definer set search_path = public, extensions as $$
  select trim(u.email) from app_setup_tokens t
    join user_permissions up on up.user_id = t.user_id and up.permission = 'mainstreet_rep'
    join app_users u on u.id = t.user_id
   where t.token_hash = encode(digest(coalesce(p_code, ''), 'sha256'), 'hex')
     and t.used_at is null and t.cancelled_at is null and t.expires_at > now()
   limit 1
$$;
revoke all on function public.ms_setup_rep_email(text) from public;
grant execute on function public.ms_setup_rep_email(text) to anon, authenticated;

-- the Reps page: the code instead of the username
drop function if exists public.ms_reps();
create function public.ms_reps()
returns table (id uuid, rep_code text, full_name text, email text, phone text, is_active boolean, must_change_password boolean,
               created_at timestamptz, setup_sent_at timestamptz, setup_used_at timestamptz, setup_error text, zones int)
language sql stable security definer set search_path = public as $$
  select u.id, u.rep_code, u.full_name, u.email, u.phone, u.is_active, u.must_change_password, u.created_at,
         t.sent_at, t.used_at, t.send_error,
         (select count(*)::int from ms_zone_campaigns zc where zc.rep_id = u.id)
    from app_users u
    join user_permissions up on up.user_id = u.id and up.permission = 'mainstreet_rep'
    left join lateral (select s.sent_at, s.used_at, s.send_error from app_setup_tokens s where s.user_id = u.id order by s.created_at desc limit 1) t on true
   where ms_is_admin()
   order by u.is_active desc, u.full_name
$$;
revoke all on function public.ms_reps() from public, anon;
grant execute on function public.ms_reps() to authenticated;

create or replace function public.ms_admin_set_rep_code(p_user uuid, p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare v text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  if not exists (select 1 from user_permissions where user_id = p_user and permission = 'mainstreet_rep') then raise exception 'Not a rep'; end if;
  if length(v) < 2 or length(v) > 12 then raise exception 'A rep code is 2 to 12 letters or numbers'; end if;
  if exists (select 1 from app_users where upper(rep_code) = v and id <> p_user) then raise exception 'Another rep has the code %', v; end if;
  update app_users set rep_code = v where id = p_user;
  return v;
end $$;
revoke all on function public.ms_admin_set_rep_code(uuid, text) from public, anon;
grant execute on function public.ms_admin_set_rep_code(uuid, text) to authenticated;

-- the kit: the rep code on the link
create or replace function public.ms_rep_kit(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c ms_campaigns;
begin
  if not (ms_rep_has_campaign(p_campaign) or ms_is_admin()) then raise exception 'Not allowed'; end if;
  select * into c from ms_campaigns where id = p_campaign;
  return jsonb_build_object('id', c.id, 'name', c.name, 'color', c.color, 'pitch', c.pitch, 'objections', c.objections,
    'info_url', c.info_url, 'info_sms', c.info_sms, 'info_email_subject', c.info_email_subject, 'info_email_body', c.info_email_body,
    'onepager_url', c.onepager_url, 'pay_per_deal', c.pay_per_deal, 'retry_days', c.retry_days,
    'ref', (select coalesce(rep_code, upper(username)) from app_users where id = auth.uid()));
end $$;

-- tidy (advisors): a fixed search path, and the trigger function isn't callable on its own
alter function public.ms_rep_hidden_login(uuid) set search_path = public;
revoke all on function public.ms_rep_login_sync() from public, anon, authenticated;
revoke all on function public.ms_rep_hidden_login(uuid) from public, anon, authenticated;

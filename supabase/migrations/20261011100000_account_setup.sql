-- Account setup emails for new managers. ADDITIVE ONLY (replaces one function).
--
-- Adding a user with an email address no longer needs a starting password: the account gets a long
-- random password nobody knows, and the user is emailed a link (through Resend, by the
-- account-setup Edge Function) to choose their own password. The link:
--   · holds a one-time code; only its SHA-256 hash is stored here
--   · works once, for 7 days, and only while the account is active
--   · is replaced when a new one is sent (sending again cancels the old link)
--
--   app_admin_create_user(...)    a NULL password now means "they'll set it from the email"
--   app_admin_issue_setup(user)   makes a new link code (Super Admin › Users permission); called by
--                                 the Edge Function with the admin's own sign-in, which emails it
--   app_setup_info(code)          the setup page: whose account it is (username, name), if valid
--   app_setup_complete(code, pw)  sets their password and uses up the link
--   app_admin_setup_status()      the Users list: when each person's link was sent / used

create table if not exists public.app_setup_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique,              -- sha256 of the code in the link; the code itself is never stored
  email text not null,
  created_by uuid,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  sent_at timestamptz,
  resend_id text,
  send_error text,
  used_at timestamptz,
  cancelled_at timestamptz
);
create index if not exists app_setup_tokens_user on public.app_setup_tokens (user_id, created_at desc);
alter table public.app_setup_tokens enable row level security;   -- no policies: only these functions touch it
revoke all on public.app_setup_tokens from anon, authenticated;

-- ───────────── creating a user: no starting password when they'll get the email ─────────────
create or replace function public.app_admin_create_user(
  p_full_name text, p_password text, p_phone text default null, p_email text default null,
  p_permissions text[] default '{}', p_centers uuid[] default '{}', p_rm_center uuid default null)
returns table (id uuid, username text) language plpgsql security definer set search_path = public, extensions as $$
declare
  v_username text;
  v_id uuid;
  v_password text := p_password;
begin
  if not app_has_perm('sa_users') then raise exception 'Not allowed'; end if;
  if 'sa_users' = any(p_permissions) or 'sa_territory' = any(p_permissions) or 'sa_reporting' = any(p_permissions) then
    if not app_is_super_admin() then raise exception 'Only the Super Admin can grant Super Admin permissions'; end if;
  end if;
  if v_password is null then
    if nullif(trim(coalesce(p_email, '')), '') is null then
      raise exception 'Add their email to send an account setup link, or give them a starting password';
    end if;
    v_password := encode(gen_random_bytes(32), 'hex');   -- nobody knows it; they choose their own from the email
  end if;
  v_username := app_make_username(p_full_name);
  v_id := app_create_auth_user(v_username, v_password);
  insert into app_users (id, username, full_name, phone, email, rm_center_id)
  values (v_id, v_username, trim(p_full_name), p_phone, nullif(trim(coalesce(p_email, '')), ''), p_rm_center);
  insert into user_permissions (user_id, permission) select v_id, unnest(p_permissions);
  insert into user_centers (user_id, center_id) select v_id, unnest(p_centers);
  return query select v_id, v_username;
end $$;
revoke all on function public.app_admin_create_user(text, text, text, text, text[], uuid[], uuid) from public, anon;
grant execute on function public.app_admin_create_user(text, text, text, text, text[], uuid[], uuid) to authenticated;

-- ───────────── a new setup link (for the Edge Function, as the admin) ─────────────
create or replace function public.app_admin_issue_setup(p_user uuid)
returns table (code text, email text, full_name text, username text, expires_at timestamptz, reply_to text, invited_by text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  u app_users;
  v_code text := encode(gen_random_bytes(32), 'hex');
  v_exp timestamptz := now() + interval '7 days';
  me app_users;
begin
  if not app_has_perm('sa_users') then raise exception 'Not allowed'; end if;
  select * into u from app_users where app_users.id = p_user;
  if u.id is null then raise exception 'No such user'; end if;
  if u.is_super_admin and not app_is_super_admin() then raise exception 'Only the Super Admin can send this account a setup link'; end if;
  if not u.is_active then raise exception '% is disabled. Turn the account on first.', u.full_name; end if;
  if nullif(trim(coalesce(u.email, '')), '') is null then raise exception '% has no email address', u.full_name; end if;
  select * into me from app_users where app_users.id = auth.uid();
  -- one live link per person: sending again cancels the old one
  update app_setup_tokens t set cancelled_at = now() where t.user_id = u.id and t.used_at is null and t.cancelled_at is null;
  insert into app_setup_tokens (user_id, token_hash, email, created_by, expires_at)
  values (u.id, encode(digest(v_code, 'sha256'), 'hex'), trim(u.email), auth.uid(), v_exp);
  return query select v_code, trim(u.email), u.full_name, u.username, v_exp, nullif(trim(coalesce(me.email, '')), ''), me.full_name;
end $$;
revoke all on function public.app_admin_issue_setup(uuid) from public, anon;
grant execute on function public.app_admin_issue_setup(uuid) to authenticated;

-- The Edge Function records whether Resend took the email (service role only).
create or replace function public.app_setup_record_send(p_code text, p_resend_id text, p_error text)
returns void language sql security definer set search_path = public, extensions as $$
  update app_setup_tokens set sent_at = case when p_error is null then now() end, resend_id = p_resend_id, send_error = left(p_error, 500)
   where token_hash = encode(digest(p_code, 'sha256'), 'hex');
$$;
revoke all on function public.app_setup_record_send(text, text, text) from public, anon, authenticated;
grant execute on function public.app_setup_record_send(text, text, text) to service_role;

-- ───────────── the setup page (signed out) ─────────────
create or replace function public.app_setup_info(p_code text)
returns table (username text, full_name text, expires_at timestamptz)
language sql stable security definer set search_path = public, extensions as $$
  select u.username, u.full_name, t.expires_at
    from app_setup_tokens t join app_users u on u.id = t.user_id
   where t.token_hash = encode(digest(coalesce(p_code, ''), 'sha256'), 'hex')
     and t.used_at is null and t.cancelled_at is null and t.expires_at > now() and u.is_active;
$$;
revoke all on function public.app_setup_info(text) from public;
grant execute on function public.app_setup_info(text) to anon, authenticated;

create or replace function public.app_setup_complete(p_code text, p_password text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare
  t app_setup_tokens;
  u app_users;
begin
  select * into t from app_setup_tokens
   where token_hash = encode(digest(coalesce(p_code, ''), 'sha256'), 'hex') for update;
  if t.id is null or t.used_at is not null or t.cancelled_at is not null or t.expires_at <= now() then
    raise exception 'This setup link has expired or was already used. Ask your admin to send a new one.';
  end if;
  select * into u from app_users where id = t.user_id;
  if u.id is null or not u.is_active then raise exception 'This account is disabled. Ask your admin.'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'Use at least 8 characters'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now() where id = u.id;
  update app_users set must_change_password = false, updated_at = now() where id = u.id;
  update app_setup_tokens set used_at = now() where id = t.id;
  return u.username;
end $$;
revoke all on function public.app_setup_complete(text, text) from public;
grant execute on function public.app_setup_complete(text, text) to anon, authenticated;

-- ───────────── the Users list ─────────────
create or replace function public.app_admin_setup_status()
returns table (user_id uuid, sent_at timestamptz, expires_at timestamptz, used_at timestamptz, send_error text, email text)
language sql stable security definer set search_path = public as $$
  select distinct on (t.user_id) t.user_id, t.sent_at, t.expires_at, t.used_at, t.send_error, t.email
    from app_setup_tokens t
   where app_has_perm('sa_users')
   order by t.user_id, t.created_at desc;
$$;
revoke all on function public.app_admin_setup_status() from public, anon;
grant execute on function public.app_admin_setup_status() to authenticated;

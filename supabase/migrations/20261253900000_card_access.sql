-- Card Processing: tell a manager when it is turned on for them, and walk them through it once.
--
--   card_access           one row per person who has (or had) the Card Processing permission: when it was turned on
--                         and by whom, whether the "you can now process cards" email went, and whether they have
--                         seen the walkthrough
--   triggers              adding the permission in User Management starts a row and asks the card-access edge
--                         function to send the email; removing it marks the row, so turning it on again later
--                         emails and walks them through again
--   card_intro()          should the app show this person the walkthrough now
--   card_intro_done()     they have seen it

create table if not exists public.card_access (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references public.app_users(id) on delete set null,
  revoked_at timestamptz,
  emailed_at timestamptz,
  email_to text,
  email_error text,
  email_tries int not null default 0,
  intro_seen_at timestamptz
);
alter table public.card_access enable row level security;
revoke all on table public.card_access from public, anon, authenticated;

-- people who had it before this existed: no email (they know), but the walkthrough once
insert into public.card_access (user_id, emailed_at, email_error)
select up.user_id, now(), 'Had access before the email existed'
  from public.user_permissions up where up.permission = 'card_processing'
on conflict (user_id) do nothing;

-- Same cron key the other scheduled functions use. pg_net sends after the transaction commits.
create or replace function public.card_access_kick()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform net.http_post(
    url := 'https://mipvcafqrmwxnoqmicxh.supabase.co/functions/v1/card-access',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-cron-key', (select value from planner_secrets where name = 'cron_key')),
    body := '{"action":"tick"}'::jsonb,
    timeout_milliseconds := 30000);
exception when others then
  null;
end $$;
revoke all on function public.card_access_kick() from public, anon, authenticated;

create or replace function public.card_access_on_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin   -- saving a user never fails because of the notice
    if tg_op = 'INSERT' then
      insert into card_access as c (user_id, granted_at, granted_by)
      values (new.user_id, now(), auth.uid())
      on conflict (user_id) do update
        set granted_at = now(), granted_by = auth.uid(), revoked_at = null, emailed_at = null, email_to = null, email_error = null,
            email_tries = 0, intro_seen_at = null;
      perform card_access_kick();
    else
      update card_access set revoked_at = now() where user_id = old.user_id and revoked_at is null;
    end if;
  exception when others then
    raise warning 'card_access: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.card_access_on_change() from public, anon, authenticated;

create or replace trigger card_access_granted after insert on public.user_permissions
  for each row when (new.permission = 'card_processing') execute function public.card_access_on_change();
create or replace trigger card_access_revoked after delete on public.user_permissions
  for each row when (old.permission = 'card_processing') execute function public.card_access_on_change();

-- ───────────── the walkthrough ─────────────
create or replace function public.card_intro()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'show', card_can() and not exists (select 1 from card_access c where c.user_id = auth.uid() and c.intro_seen_at is not null),
    'granted_by', (select u.full_name from card_access c join app_users u on u.id = c.granted_by where c.user_id = auth.uid() and c.granted_by is distinct from auth.uid()))
$$;
revoke all on function public.card_intro() from public, anon;
grant execute on function public.card_intro() to authenticated;

create or replace function public.card_intro_done()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not card_can() then return; end if;
  insert into card_access as c (user_id, emailed_at, email_error, intro_seen_at)
  values (auth.uid(), now(), 'Had access before the email existed', now())
  on conflict (user_id) do update set intro_seen_at = coalesce(c.intro_seen_at, now());
end $$;
revoke all on function public.card_intro_done() from public, anon;
grant execute on function public.card_intro_done() to authenticated;

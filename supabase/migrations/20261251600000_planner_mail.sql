-- Planner: each person's email, connected to Arvy (Settings → Email; supabase/functions/planner-mail).
--
-- A person connects their own mailboxes (Gmail for now; `provider` is there so Outlook can be added). Signing in
-- happens on Google's own page: nothing here ever holds an email password. What is kept for a mailbox is Google's
-- refresh token, the key that lets the planner-mail function read that mailbox. It is encrypted by the function before
-- it gets here (AES-GCM, with a key that lives only in the function's secrets: PLANNER_MAIL_KEY), so this table on
-- its own opens nothing. Both tables have row level security ON and NO policies: only the function's service role
-- reads or writes them. The browser never sees a row; it asks the function, which answers with the address, the
-- switches and the mail itself, never the token.
--
-- A mailbox belongs to ONE person (user_id), not to the household: Vijay's and Rosh's never mix. Every look-up the
-- function makes carries the person's id.
--
-- What comes in is turned into offered to-dos: every 30 minutes the function reads the new email in the Primary
-- inbox of each mailbox that has it switched on and saves what it finds as the person's own planner docs (kind
-- 'mailtodo', private to them like any kind that isn't on the shared list). No change to planner_docs is needed.
--
-- Additive only: two new tables and one cron job. Nothing existing is touched.

-- ───────────── connected mailboxes ─────────────
create table if not exists public.planner_mailboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.planner_users(id),      -- whose mailbox it is: theirs alone
  provider text not null check (provider in ('google', 'microsoft')),
  address text not null check (address = lower(address)),         -- the email address, as Google gives it
  token_enc text,                                                 -- the refresh token, encrypted by the function ("v1.<iv>.<locked>").
                                                                  -- null = the sign-in ran out or was taken back at Google: connect again
  scopes text not null default '',                                -- what Google was asked for and gave: reading, sending
  todos boolean not null default true,                            -- "turn what comes in into to-dos" on or off
  last_checked_at timestamptz,                                    -- when the 30-minute check last looked
  cursor jsonb,                                                   -- where that check has got to: { after: <ms>, seen: [message ids] }, so no email is read twice
  problem text,                                                   -- what went wrong last, in plain words for the person (null = nothing)
  created_at timestamptz not null default now(),
  -- the same address can't be connected twice by one person (connecting it again replaces the token)
  constraint planner_mailboxes_one_per_person unique (user_id, provider, address)
);
create index if not exists planner_mailboxes_user_idx on public.planner_mailboxes(user_id);

alter table public.planner_mailboxes enable row level security;
-- no policies: only the planner-mail edge function (service role) reads or writes it
revoke all on table public.planner_mailboxes from anon, authenticated;

-- ───────────── sign-ins that have been started ─────────────
-- When someone taps Connect, the function makes a random value, sends it to Google with them and keeps only its
-- SHA-256 here, with who started it and which planner they came from. Google hands the value back when they return.
-- It is good once (used_at is set in the same statement that finds it) and for 10 minutes (expires_at), and the
-- mailbox is stored for the person in this row: never for anyone named in the request that comes back.
create table if not exists public.planner_mail_states (
  state_hash text primary key,                                    -- sha-256 (hex) of the value; the value itself is kept nowhere
  user_id uuid not null references public.planner_users(id),
  app text not null check (app in ('vijayplanner', 'roshplanner')),   -- where to send the browser back to
  provider text not null check (provider in ('google', 'microsoft')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists planner_mail_states_user_idx on public.planner_mail_states(user_id);

alter table public.planner_mail_states enable row level security;
-- no policies: only the planner-mail edge function (service role) reads or writes it
revoke all on table public.planner_mail_states from anon, authenticated;

-- ───────────── the check, every 30 minutes ─────────────
-- At 8 and 38 minutes past the hour: POST { action: 'check' } to planner-mail with the cron key (the same
-- planner_secrets.cron_key that planner-push and planner-plaid check). The function reads at most 25 new emails a
-- mailbox, asks Claude once per mailbox that has any, and sends one notification when it found something.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'planner-mail-check') then
    perform cron.schedule('planner-mail-check', '8,38 * * * *', $job$
      select net.http_post(
        url := 'https://mipvcafqrmwxnoqmicxh.supabase.co/functions/v1/planner-mail',
        headers := jsonb_build_object('content-type', 'application/json',
                                      'x-cron-key', (select value from public.planner_secrets where name = 'cron_key')),
        body := '{"action":"check"}'::jsonb,
        timeout_milliseconds := 140000)
    $job$);
  end if;
end $$;

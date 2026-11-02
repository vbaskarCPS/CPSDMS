-- Planner: bank connections through Plaid (Money → Accounts → Connect a bank).
--
-- Each connection (a Plaid "Item": one bank sign-in) belongs to the household that shares the money
-- docs (planner_users.household_id), and records who connected it. Plaid's access token for a
-- connection is the key to that bank's data, so it is never stored in a plain column: it goes into
-- Supabase Vault (encrypted at rest) and only the planner-plaid edge function (service role) can read
-- it back, through planner_plaid_token(). The browser never sees it.
--
-- Transactions land in the same household docs the CSV importer writes (kind 'txns', one doc per
-- month), with ids 'plaid_<transaction id>'. For an account that's connected, the app shows Plaid's
-- rows and hides the CSV rows (they're kept, not deleted).
--
-- Additive only: one new table, three service-role functions, one daily cron job.

create table if not exists public.planner_bank_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.planner_users(id),
  added_by uuid not null references public.planner_users(id),
  item_id text not null unique,                 -- Plaid's id for the connection (not a secret)
  token_secret_id uuid,                         -- vault.secrets id holding the access token
  institution_id text,
  institution_name text,
  accounts jsonb not null default '[]'::jsonb,  -- [{ plaidId, name, mask, type, subtype, plannerId|null }]
  cursor text,                                  -- /transactions/sync position
  status text not null default 'active' check (status in ('active', 'login_required', 'error', 'removed')),
  error text,
  last_sync_at timestamptz,
  last_webhook_at timestamptz,
  created_at timestamptz not null default now(),
  removed_at timestamptz
);
create index if not exists planner_bank_items_household_idx on public.planner_bank_items(household_id);

alter table public.planner_bank_items enable row level security;
-- no policies: only the planner-plaid edge function (service role) reads or writes it
revoke all on table public.planner_bank_items from anon, authenticated;

-- Save (or replace) a connection's access token in Vault and return the row.
create or replace function public.planner_plaid_save_item(
  p_household uuid, p_added_by uuid, p_item_id text, p_access_token text,
  p_institution_id text, p_institution_name text, p_accounts jsonb)
returns public.planner_bank_items language plpgsql volatile security definer set search_path = public, vault as $$
declare r planner_bank_items; v_secret uuid;
begin
  if coalesce(p_item_id, '') = '' or coalesce(p_access_token, '') = '' then raise exception 'item and token required'; end if;
  select * into r from planner_bank_items where item_id = p_item_id;
  if r.token_secret_id is not null then
    perform vault.update_secret(r.token_secret_id, p_access_token);
    v_secret := r.token_secret_id;
  else
    v_secret := vault.create_secret(p_access_token, 'plaid:' || p_item_id, 'Plaid access token for a planner bank connection');
  end if;
  insert into planner_bank_items (household_id, added_by, item_id, token_secret_id, institution_id, institution_name, accounts)
  values (p_household, p_added_by, p_item_id, v_secret, p_institution_id, p_institution_name, coalesce(p_accounts, '[]'::jsonb))
  on conflict (item_id) do update set token_secret_id = excluded.token_secret_id,
    institution_id = coalesce(excluded.institution_id, planner_bank_items.institution_id),
    institution_name = coalesce(excluded.institution_name, planner_bank_items.institution_name),
    accounts = case when jsonb_array_length(excluded.accounts) > 0 then excluded.accounts else planner_bank_items.accounts end,
    status = 'active', error = null, removed_at = null
  returning * into r;
  return r;
end $$;

-- The access token for a connection (null once it's been disconnected).
create or replace function public.planner_plaid_token(p_item_id text)
returns text language sql stable security definer set search_path = public, vault as $$
  select s.decrypted_secret from planner_bank_items i join vault.decrypted_secrets s on s.id = i.token_secret_id
   where i.item_id = p_item_id and i.status <> 'removed'
$$;

-- Disconnecting: the token is revoked at Plaid first; here it's blanked in Vault and the row marked removed.
create or replace function public.planner_plaid_forget(p_item_id text)
returns void language plpgsql volatile security definer set search_path = public, vault as $$
declare v_secret uuid;
begin
  select token_secret_id into v_secret from planner_bank_items where item_id = p_item_id;
  if v_secret is not null then perform vault.update_secret(v_secret, 'revoked'); end if;
  update planner_bank_items set status = 'removed', removed_at = now(), cursor = null where item_id = p_item_id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['planner_plaid_save_item(uuid, uuid, text, text, text, text, jsonb)', 'planner_plaid_token(text)', 'planner_plaid_forget(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ───────────── daily sync ─────────────
-- Plaid's webhook brings new transactions in as they post; this catches anything a webhook missed.
-- 10:23 UTC = 5:23 am Toronto. Same cron key as planner-push (planner_secrets.cron_key).
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'planner-plaid-daily') then
    perform cron.schedule('planner-plaid-daily', '23 10 * * *', $job$
      select net.http_post(
        url := 'https://mipvcafqrmwxnoqmicxh.supabase.co/functions/v1/planner-plaid',
        headers := jsonb_build_object('content-type', 'application/json',
                                      'x-cron-key', (select value from public.planner_secrets where name = 'cron_key')),
        body := '{"action":"tick"}'::jsonb,
        timeout_milliseconds := 120000)
    $job$);
  end if;
end $$;

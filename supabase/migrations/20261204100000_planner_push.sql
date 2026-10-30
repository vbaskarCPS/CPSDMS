-- Vijay Planner: push notifications. The phone's push subscription is kept as a planner doc
-- (kind 'push', key = sha256(endpoint)) through two token-checked functions; every 5 minutes pg_cron
-- asks the planner-push edge function (action 'tick') to send whichever routine reminders are due.
-- Nothing is ever deleted: forgetting a subscription writes its doc to JSON null (planner_get leaves
-- those out). The cron key is read from planner_secrets, filled by hand (no value in this file).

create extension if not exists pg_net with schema extensions;

-- ───────────── secrets for cron (the key the edge function checks) ─────────────
create table if not exists public.planner_secrets (
  name text primary key,
  value text not null
);
alter table public.planner_secrets enable row level security;
-- no policies: only the cron job (superuser context) and the service role read it

-- ───────────── subscribe / unsubscribe ─────────────
create or replace function public.planner_push_subscribe(p_token text, p_endpoint text, p_p256dh text, p_auth text, p_agent text default null)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare u planner_users; v_key text; v_existing jsonb;
begin
  u := planner_token_user(p_token);
  if u.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  if coalesce(p_endpoint, '') !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    return jsonb_build_object('ok', false, 'reason', 'bad_subscription');
  end if;
  v_key := left(encode(digest(p_endpoint, 'sha256'), 'hex'), 32);
  select data into v_existing from planner_docs where user_id = u.id and kind = 'push' and key = v_key;
  insert into planner_docs (user_id, kind, key, data)
  values (u.id, 'push', v_key, jsonb_build_object(
    'endpoint', p_endpoint, 'p256dh', p_p256dh, 'auth', p_auth, 'agent', left(coalesce(p_agent, ''), 200),
    'createdAt', coalesce(case when jsonb_typeof(v_existing) = 'object' then v_existing->>'createdAt' end, now()::text),
    'lastSeenAt', now()::text))
  on conflict (user_id, kind, key) do update set data = excluded.data, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.planner_push_unsubscribe(p_token text, p_endpoint text)
returns jsonb language plpgsql volatile security definer set search_path = public, extensions as $$
declare u planner_users; v_key text;
begin
  u := planner_token_user(p_token);
  if u.id is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  v_key := left(encode(digest(coalesce(p_endpoint, ''), 'sha256'), 'hex'), 32);
  update planner_docs set data = 'null'::jsonb, updated_at = now()
   where user_id = u.id and kind = 'push' and key = v_key;
  return jsonb_build_object('ok', true);
end $$;

do $$
declare f text;
begin
  foreach f in array array['planner_push_subscribe(text, text, text, text, text)', 'planner_push_unsubscribe(text, text)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;

-- ───────────── the scheduler ─────────────
-- Every 5 minutes: POST { action: 'tick' } to planner-push with the cron key. The function works out
-- which reminders are due (Toronto time) and sends them once.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'planner-push-tick') then
    perform cron.schedule('planner-push-tick', '*/5 * * * *', $job$
      select net.http_post(
        url := 'https://mipvcafqrmwxnoqmicxh.supabase.co/functions/v1/planner-push',
        headers := jsonb_build_object('content-type', 'application/json',
                                      'x-cron-key', (select value from public.planner_secrets where name = 'cron_key')),
        body := '{"action":"tick"}'::jsonb)
    $job$);
  end if;
end $$;

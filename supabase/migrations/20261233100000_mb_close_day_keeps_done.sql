-- Closing a day archives its transactions and then removes them. The route manager's sync trigger
-- (mb_from_transaction, 20261127100000) read that removal as "job undone" and reopened every booking
-- the crew had finished — Abbotsford, 2026-10-31: nine done jobs back to open the second the day closed.
-- A removal of a transaction that is already in the archive is the day closing, not an undo.
create or replace function public.mb_from_transaction()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_day date;
begin
  if tg_op = 'DELETE' then
    if old.job_id like 'mb:%'
       and not exists (select 1 from archive.session_rows a where a.source_table = 'transactions' and a.row_data->>'id' = old.id::text) then
      begin v_id := substring(old.job_id from 4)::uuid; exception when others then return null; end;
      update mb_bookings set status = 'open', done_on = null, done_by = null, done_by_name = null, done_services = null, done_tx = null, updated_at = now()
       where id = v_id and done_tx = old.id;
    end if;
    return null;
  end if;
  if new.job_id like 'mb:%' and coalesce(new.type, '') = 'Production' then
    begin v_id := substring(new.job_id from 4)::uuid; exception when others then return null; end;
    select bk.session_date into v_day from bookings bk where bk.booking_id = new.job_id and bk.command_center_id = new.command_center_id
     order by bk.session_date desc nulls last limit 1;
    update mb_bookings set status = 'done',
           done_on = coalesce(v_day, (coalesce(new."timestamp", now()) at time zone 'America/Vancouver')::date),
           done_by = new.worker_id, done_by_name = new.worker_name, done_services = nullif(new.services, '{}'::jsonb),
           done_tx = new.id, updated_at = now()
     where id = v_id and (status <> 'done' or done_tx is distinct from new.id or done_services is distinct from nullif(new.services, '{}'::jsonb));
  end if;
  return null;
end $$;
revoke all on function public.mb_from_transaction() from public, anon, authenticated;

-- Put back what the 2026-10-31 close undid: each booking done, on that day, by the worker whose
-- archived Production transaction carries it.
update mb_bookings b
   set status = 'done', done_on = a.day, done_by = a.row_data->>'worker_id', done_by_name = a.row_data->>'worker_name',
       done_services = nullif(a.row_data->'services', '{}'::jsonb), done_tx = (a.row_data->>'id')::uuid, updated_at = now()
  from archive.session_rows a
 where a.source_table = 'transactions' and a.row_data->>'type' = 'Production' and a.row_data->>'job_id' = 'mb:' || b.id::text
   and b.status = 'open' and b.done_on is null and b.updated_at = (select closed_at from days d where d.center_id = a.center_id and d.day = a.day);

-- Planner: the shared household calendar. Docs of kind 'event' live under the household owner
-- (Vijay's rows), so Vijay and Rosh read and write the same calendar. Additive: only the list of
-- shared kinds changes.
create or replace function public.planner_shared_kind(p_kind text)
returns boolean language sql immutable set search_path = public as $$
  select p_kind in ('account', 'txns', 'rule', 'budget', 'moneyprefs', 'event')
$$;

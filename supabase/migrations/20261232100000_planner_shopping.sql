-- Planner: the shared shopping list. Docs of kind 'shop' (items) and 'shopprefs' (postal code, stores)
-- live under the household owner, so Vijay and Rosh share one list. Additive: only the shared-kinds list.
create or replace function public.planner_shared_kind(p_kind text)
returns boolean language sql immutable set search_path = public as $$
  select p_kind in ('account', 'txns', 'rule', 'budget', 'moneyprefs', 'event', 'shop', 'shopprefs')
$$;

-- MainstreetAI › Cities › Rebuild keeps a city's saved streets instead of fetching them again from OpenStreetMap
-- (a big city's streets are the slowest part, and the free servers often time out). Additive only.
create or replace function public.ms_city_line_count(p_city uuid)
returns int language plpgsql stable security definer set search_path = public as $$
begin
  if not ms_is_admin() then raise exception 'Not allowed'; end if;
  return (select count(*)::int from ms_city_lines where city_id = p_city);
end $$;
revoke all on function public.ms_city_line_count(uuid) from public, anon;
grant execute on function public.ms_city_line_count(uuid) to authenticated;

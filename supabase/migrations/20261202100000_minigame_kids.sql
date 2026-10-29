-- Minigame kid and adult accounts (Little Lessons). Kiaan is the only kid: signing in takes him straight
-- into Little Lessons. Adults see the games and a "Kiaan's lessons" page where they set his lesson mix
-- (saved in his progress as "lessons_settings") and can see how he's doing.
-- Additive only.

alter table public.minigame_players add column if not exists kind text not null default 'adult' check (kind in ('adult', 'kid'));
update public.minigame_players set kind = 'kid' where name = 'Kiaan';

-- who can play: now with adult / kid
create or replace function public.minigame_players_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'has_pin', pin_hash is not null, 'kind', kind) order by kind, name), '[]'::jsonb)
    from minigame_players
$$;

create or replace function public.minigame_me(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', pl.id, 'name', pl.name, 'kind', pl.kind) from minigame_players pl where pl.id = minigame_player_of(p_token)
$$;

-- a kid can't change their own lesson settings (only a grown-up can, below)
create or replace function public.minigame_save(p_token text, p_game text, p_data jsonb)
returns timestamptz language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token); t timestamptz := now();
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  if p_game = 'lessons_settings' then raise exception 'Only a grown-up can change lesson settings'; end if;
  insert into minigame_progress (player_id, game, data, updated_at) values (me, p_game, coalesce(p_data, '{}'::jsonb), t)
  on conflict (player_id, game) do update set data = excluded.data, updated_at = t;
  return t;
end $$;

-- the kids, with their lessons and settings (adults only)
create or replace function public.minigame_kids(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token);
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  if not exists (select 1 from minigame_players where id = me and kind = 'adult') then raise exception 'Only grown-ups can see this'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name,
           'lessons', (select g.data from minigame_progress g where g.player_id = k.id and g.game = 'lessons'),
           'chess', (select g.data from minigame_progress g where g.player_id = k.id and g.game = 'chess'),
           'settings', (select g.data from minigame_progress g where g.player_id = k.id and g.game = 'lessons_settings'),
           'updated_at', (select g.updated_at from minigame_progress g where g.player_id = k.id and g.game = 'lessons')) order by k.name)
           from minigame_players k where k.kind = 'kid'), '[]'::jsonb);
end $$;

-- a grown-up saves a kid's lesson settings
create or replace function public.minigame_kid_settings_save(p_token text, p_kid uuid, p_data jsonb)
returns timestamptz language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token); t timestamptz := now();
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  if not exists (select 1 from minigame_players where id = me and kind = 'adult') then raise exception 'Only grown-ups can change this'; end if;
  if not exists (select 1 from minigame_players where id = p_kid and kind = 'kid') then raise exception 'No such kid'; end if;
  if jsonb_typeof(p_data) <> 'object' then raise exception 'Settings must be an object'; end if;
  insert into minigame_progress (player_id, game, data, updated_at) values (p_kid, 'lessons_settings', p_data, t)
  on conflict (player_id, game) do update set data = excluded.data, updated_at = t;
  return t;
end $$;

revoke all on function public.minigame_kids(text), public.minigame_kid_settings_save(text, uuid, jsonb) from public;
grant execute on function public.minigame_kids(text), public.minigame_kid_settings_save(text, uuid, jsonb) to anon, authenticated;

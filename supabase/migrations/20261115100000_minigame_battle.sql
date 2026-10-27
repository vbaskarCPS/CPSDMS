-- Minigame Battleship (propertystars.app/minigame/battle): two players, each on their own phone.
-- Each places a fleet on a 10×10 board (Carrier 5, Battleship 4, Cruiser 3, Submarine 3,
-- Destroyer 2), then they take turns firing one shot at the other's waters. A hit earns another
-- shot; a miss passes the turn. 30 s a turn or it passes. Sink the whole fleet to win.
--
-- Fleets are kept here and never sent to the other phone: it only learns hit, miss, and a ship's
-- position once that ship is sunk (and every ship at the end).
--
-- Additive only. The table is closed to the public key (RLS on, no grants); the page reaches it
-- only through the minigame_battle_* functions, which need a player's pass token.

create table if not exists public.minigame_battle (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z]{4}$'),
  host uuid not null references public.minigame_players(id) on delete cascade,
  guest uuid references public.minigame_players(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'placing', 'playing', 'done', 'left', 'expired')),
  host_ships jsonb,                       -- [[cells of the Carrier], [Battleship], …] cells 0–99 = row*10 + col (secret)
  guest_ships jsonb,
  host_shots int[] not null default '{}', -- where the host has fired, in order
  guest_shots int[] not null default '{}',
  turn uuid,
  turn_deadline timestamptz,
  winner uuid,
  last jsonb,                             -- the latest shot: {by, c, hit, sunk}
  version int not null default 0,
  left_by uuid,
  next_match uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,                 -- when both were in (placing began)
  finished_at timestamptz
);
create unique index if not exists minigame_battle_live_code on public.minigame_battle (code) where status in ('waiting', 'placing', 'playing');
create index if not exists minigame_battle_host_idx on public.minigame_battle (host, created_at desc);
create index if not exists minigame_battle_guest_idx on public.minigame_battle (guest, created_at desc);

alter table public.minigame_battle enable row level security;
revoke all on public.minigame_battle from anon, authenticated;

-- ── internal helpers (not callable from the page) ──

-- every cell a fleet covers
create or replace function public.minigame_battle_cells(p_ships jsonb)
returns int[] language sql immutable security definer set search_path = public as $$
  select coalesce(array_agg(x::int), '{}') from jsonb_array_elements(coalesce(p_ships, '[]'::jsonb)) s, jsonb_array_elements_text(s) x
$$;
revoke all on function public.minigame_battle_cells(jsonb) from public, anon, authenticated;

-- is this a proper fleet? five straight ships of 5, 4, 3, 3, 2 on the board, not overlapping
create or replace function public.minigame_battle_fleet_ok(p_ships jsonb)
returns boolean language plpgsql immutable security definer set search_path = public as $$
declare lens int[] := array[5, 4, 3, 3, 2]; i int; s jsonb; cells int[]; c int; all_cells int[] := '{}'; step int;
begin
  if p_ships is null or jsonb_typeof(p_ships) <> 'array' or jsonb_array_length(p_ships) <> 5 then return false; end if;
  for i in 1..5 loop
    s := p_ships -> (i - 1);
    if jsonb_typeof(s) <> 'array' or jsonb_array_length(s) <> lens[i] then return false; end if;
    if exists (select 1 from jsonb_array_elements(s) e where jsonb_typeof(e) <> 'number') then return false; end if;
    select array_agg(e::text::int order by e::text::int) into cells from jsonb_array_elements(s) e;
    foreach c in array cells loop if c < 0 or c > 99 then return false; end if; end loop;
    step := cells[2] - cells[1];
    if step not in (1, 10) then return false; end if;
    for c in 2..lens[i] loop
      if cells[c] - cells[c - 1] <> step then return false; end if;
      if step = 1 and cells[c] / 10 <> cells[1] / 10 then return false; end if;   -- doesn't wrap onto the next row
    end loop;
    all_cells := all_cells || cells;
  end loop;
  return (select count(distinct x) from unnest(all_cells) x) = 17;
end $$;
revoke all on function public.minigame_battle_fleet_ok(jsonb) from public, anon, authenticated;

-- which ships these shots have sunk: [{"i": 2, "cells": [...]}, ...]
create or replace function public.minigame_battle_sunk(p_ships jsonb, p_shots int[])
returns jsonb language sql immutable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('i', o - 1, 'cells', s) order by o), '[]'::jsonb)
    from jsonb_array_elements(coalesce(p_ships, '[]'::jsonb)) with ordinality t(s, o)
   where not exists (select 1 from jsonb_array_elements_text(s) x where not (x::int = any(p_shots)))
$$;
revoke all on function public.minigame_battle_sunk(jsonb, int[]) from public, anon, authenticated;

-- move things along: a slow turn passes; a code nobody used, or a fleet nobody placed, expires
create or replace function public.minigame_battle_tick(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare m minigame_battle;
begin
  select * into m from minigame_battle where id = p_id for update;
  if not found then return; end if;
  if (m.status = 'waiting' and m.created_at < now() - interval '15 minutes')
     or (m.status = 'placing' and m.started_at < now() - interval '30 minutes') then
    update minigame_battle set status = 'expired', version = m.version + 1 where id = m.id; return;
  end if;
  if m.status = 'playing' and now() >= m.turn_deadline then
    update minigame_battle set turn = case when m.turn = m.host then m.guest else m.host end, turn_deadline = now() + interval '30 seconds',
           last = jsonb_build_object('timeout', true, 'by', m.turn), version = m.version + 1 where id = m.id;
  end if;
end $$;
revoke all on function public.minigame_battle_tick(uuid) from public, anon, authenticated;

-- what one player sees: their own fleet, every shot (hit or miss), the other's sunk ships;
-- the other's whole fleet only once the game is over. (volatile: sees rows written in the same call)
create or replace function public.minigame_battle_view(p_id uuid, p_me uuid)
returns jsonb language sql volatile security definer set search_path = public as $$
  with m as (select b.*, (p_me = b.host) as me_host from minigame_battle b where b.id = p_id),
  s as (select m.*,
          case when me_host then host_ships else guest_ships end as my_ships,
          case when me_host then guest_ships else host_ships end as their_ships,
          case when me_host then host_shots else guest_shots end as my_shots,
          case when me_host then guest_shots else host_shots end as their_shots
        from m)
  select jsonb_build_object(
    'id', s.id, 'code', s.code, 'status', s.status, 'turn', s.turn, 'turn_deadline', s.turn_deadline, 'winner', s.winner,
    'my_ships', s.my_ships, 'me_ready', s.my_ships is not null, 'them_ready', s.their_ships is not null,
    'my_shots', (select coalesce(jsonb_agg(jsonb_build_object('c', c, 'hit', c = any(minigame_battle_cells(s.their_ships))) order by o), '[]'::jsonb)
                   from unnest(s.my_shots) with ordinality u(c, o)),
    'their_shots', (select coalesce(jsonb_agg(jsonb_build_object('c', c, 'hit', c = any(minigame_battle_cells(s.my_ships))) order by o), '[]'::jsonb)
                   from unnest(s.their_shots) with ordinality u(c, o)),
    'their_sunk', minigame_battle_sunk(s.their_ships, s.my_shots),
    'my_sunk', minigame_battle_sunk(s.my_ships, s.their_shots),
    'their_ships', case when s.status = 'done' then s.their_ships end,
    'last', s.last, 'version', s.version,
    'host', jsonb_build_object('id', h.id, 'name', h.name),
    'guest', case when g.id is null then null else jsonb_build_object('id', g.id, 'name', g.name) end,
    'left_by', s.left_by, 'next_match', s.next_match, 'finished_at', s.finished_at, 'now', now())
  from s join minigame_players h on h.id = s.host left join minigame_players g on g.id = s.guest
$$;
revoke all on function public.minigame_battle_view(uuid, uuid) from public, anon, authenticated;

create or replace function public.minigame_battle_new(p_host uuid, p_guest uuid)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_code text; v_id uuid; i int;
begin
  update minigame_battle set status = 'expired' where status = 'waiting' and host = p_host;
  for i in 1..50 loop
    v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 24)::int, 1), '') from generate_series(1, 4));
    exit when not exists (select 1 from minigame_battle where code = v_code and status in ('waiting', 'placing', 'playing'));
  end loop;
  insert into minigame_battle (code, host, guest) values (v_code, p_host, p_guest) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.minigame_battle_new(uuid, uuid) from public, anon, authenticated;

-- ── what the page calls ──

create or replace function public.minigame_battle_create(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token);
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  return minigame_battle_view(minigame_battle_new(me, null), me);
end $$;

create or replace function public.minigame_battle_join(p_token text, p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token); m minigame_battle;
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  select * into m from minigame_battle where code = upper(btrim(coalesce(p_code, ''))) and status = 'waiting' for update;
  if not found or m.created_at < now() - interval '15 minutes' then return jsonb_build_object('ok', false, 'reason', 'no_match'); end if;
  if m.host = me then return jsonb_build_object('ok', false, 'reason', 'own_match'); end if;
  if m.guest is not null and m.guest <> me then return jsonb_build_object('ok', false, 'reason', 'no_match'); end if;
  update minigame_battle set guest = me, status = 'placing', started_at = now(), version = m.version + 1 where id = m.id;
  return jsonb_build_object('ok', true, 'match', minigame_battle_view(m.id, me));
end $$;

create or replace function public.minigame_battle_state(p_token text, p_match uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token);
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  if not exists (select 1 from minigame_battle where id = p_match and me in (host, guest)) then
    raise exception 'Not your match' using errcode = '42501';
  end if;
  perform minigame_battle_tick(p_match);
  return minigame_battle_view(p_match, me);
end $$;

-- lock in your fleet. Once both are in, the battle starts and a coin toss picks who fires first.
create or replace function public.minigame_battle_place(p_token text, p_match uuid, p_ships jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token); m minigame_battle;
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  perform minigame_battle_tick(p_match);
  select * into m from minigame_battle where id = p_match for update;
  if not found or me not in (m.host, coalesce(m.guest, m.host)) then raise exception 'Not your match' using errcode = '42501'; end if;
  if m.status <> 'placing' then return jsonb_build_object('ok', false, 'reason', 'not_placing', 'match', minigame_battle_view(p_match, me)); end if;
  if not minigame_battle_fleet_ok(p_ships) then return jsonb_build_object('ok', false, 'reason', 'bad_fleet', 'match', minigame_battle_view(p_match, me)); end if;
  if (me = m.host and m.host_ships is not null) or (me = m.guest and m.guest_ships is not null) then
    return jsonb_build_object('ok', false, 'reason', 'already_placed', 'match', minigame_battle_view(p_match, me));
  end if;
  if me = m.host then update minigame_battle set host_ships = p_ships, version = m.version + 1 where id = m.id;
  else update minigame_battle set guest_ships = p_ships, version = m.version + 1 where id = m.id; end if;
  update minigame_battle set status = 'playing', turn = case when random() < 0.5 then host else guest end,
         turn_deadline = now() + interval '33 seconds', version = version + 1
   where id = m.id and host_ships is not null and guest_ships is not null;
  return jsonb_build_object('ok', true, 'match', minigame_battle_view(p_match, me));
end $$;

-- fire at a cell (0–99) of the other player's waters. A hit fires again; a miss passes the turn.
create or replace function public.minigame_battle_fire(p_token text, p_match uuid, p_cell int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token); m minigame_battle; mine_host boolean; shots int[]; target jsonb;
  hit boolean; sunk_before int; sunk_now jsonb; all_sunk boolean; new_sunk jsonb;
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  perform minigame_battle_tick(p_match);
  select * into m from minigame_battle where id = p_match for update;
  if not found or me not in (m.host, coalesce(m.guest, m.host)) then raise exception 'Not your match' using errcode = '42501'; end if;
  mine_host := me = m.host;
  shots := case when mine_host then m.host_shots else m.guest_shots end;
  if m.status <> 'playing' or m.turn <> me or p_cell is null or p_cell < 0 or p_cell > 99 or p_cell = any(shots) then
    return minigame_battle_view(p_match, me);
  end if;
  target := case when mine_host then m.guest_ships else m.host_ships end;
  hit := p_cell = any(minigame_battle_cells(target));
  sunk_before := jsonb_array_length(minigame_battle_sunk(target, shots));
  shots := shots || p_cell;
  sunk_now := minigame_battle_sunk(target, shots);
  new_sunk := case when jsonb_array_length(sunk_now) > sunk_before
                   then (select x from jsonb_array_elements(sunk_now) x where p_cell::text in (select jsonb_array_elements_text(x -> 'cells'))) end;
  all_sunk := jsonb_array_length(sunk_now) = 5;
  update minigame_battle set
    host_shots = case when mine_host then shots else host_shots end,
    guest_shots = case when mine_host then guest_shots else shots end,
    turn = case when all_sunk then null when hit then me when mine_host then guest else host end,
    turn_deadline = now() + interval '30 seconds',
    status = case when all_sunk then 'done' else status end,
    winner = case when all_sunk then me else winner end,
    finished_at = case when all_sunk then now() else finished_at end,
    last = jsonb_build_object('by', me, 'c', p_cell, 'hit', hit, 'sunk', new_sunk),
    version = m.version + 1
  where id = m.id;
  return minigame_battle_view(p_match, me);
end $$;

create or replace function public.minigame_battle_leave(p_token text, p_match uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token);
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  update minigame_battle set status = case when status = 'waiting' then 'expired' else 'left' end, left_by = me,
         finished_at = now(), version = version + 1
   where id = p_match and me in (host, guest) and status in ('waiting', 'placing', 'playing');
end $$;

-- play again: whoever asks first makes the new match and waits; it starts (placing) when the other asks too
create or replace function public.minigame_battle_rematch(p_token text, p_match uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token); m minigame_battle; v_new uuid;
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  select * into m from minigame_battle where id = p_match and me in (host, guest) for update;
  if not found then raise exception 'Not your match' using errcode = '42501'; end if;
  if m.guest is null or m.status not in ('done', 'left') then return jsonb_build_object('ok', false, 'reason', 'not_finished'); end if;
  if m.next_match is null then
    v_new := minigame_battle_new(me, case when me = m.host then m.guest else m.host end);
    update minigame_battle set next_match = v_new, version = version + 1 where id = m.id;
  else
    v_new := m.next_match;
    update minigame_battle set status = 'placing', started_at = now(), version = version + 1
     where id = v_new and guest = me and status = 'waiting';
  end if;
  return jsonb_build_object('ok', true, 'match', minigame_battle_view(v_new, me));
end $$;

-- this player's finished games (newest first), for the head-to-head record
create or replace function public.minigame_battle_history(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token);
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'host', jsonb_build_object('id', h.id, 'name', h.name),
                     'guest', jsonb_build_object('id', g.id, 'name', g.name), 'winner', m.winner,
                     'host_shots', cardinality(m.host_shots), 'guest_shots', cardinality(m.guest_shots), 'finished_at', m.finished_at) order by m.finished_at desc)
    from (select * from minigame_battle where me in (host, guest) and status = 'done' order by finished_at desc limit 100) m
    join minigame_players h on h.id = m.host join minigame_players g on g.id = m.guest), '[]'::jsonb);
end $$;

revoke all on function public.minigame_battle_create(text), public.minigame_battle_join(text, text), public.minigame_battle_state(text, uuid),
  public.minigame_battle_place(text, uuid, jsonb), public.minigame_battle_fire(text, uuid, int), public.minigame_battle_leave(text, uuid),
  public.minigame_battle_rematch(text, uuid), public.minigame_battle_history(text) from public;
grant execute on function public.minigame_battle_create(text), public.minigame_battle_join(text, text), public.minigame_battle_state(text, uuid),
  public.minigame_battle_place(text, uuid, jsonb), public.minigame_battle_fire(text, uuid, int), public.minigame_battle_leave(text, uuid),
  public.minigame_battle_rematch(text, uuid), public.minigame_battle_history(text) to anon, authenticated;

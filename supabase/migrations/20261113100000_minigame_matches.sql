-- Minigame head-to-head matches (Pour PvP, propertystars.app/minigame/pour). Two signed-in players
-- race on the same puzzles, each on their own phone: one creates a match and gets a 4-letter code,
-- the other joins with it. 5 rounds; each round both get the same deal (level size + seed chosen
-- here, the deal built on the phone). Times are measured here, on the server, so both phones agree.
-- The phones check in about once a second (minigame_match_state); points are worked out on the
-- phone from the board (src/lib/pour/pvp.ts) so there is one scoring rule.
--
-- Additive only. The table is closed to the public key (RLS on, no grants); the page reaches it
-- only through the minigame_match_* functions, which need a player's pass token.

create table if not exists public.minigame_matches (
  id uuid primary key default gen_random_uuid(),
  game text not null default 'pour' check (game ~ '^[a-z0-9_-]{1,40}$'),
  code text not null check (code ~ '^[A-Z]{4}$'),
  host uuid not null references public.minigame_players(id) on delete cascade,
  guest uuid references public.minigame_players(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'done', 'left', 'expired')),
  levels int[] not null,                       -- how big each round's puzzle is (a Pour level number)
  seeds int[] not null,                        -- and which deal of that size
  round int not null default 0,                -- 0-based
  round_start timestamptz,                     -- when the current round's GO is
  round_end timestamptz,                       -- when it closes: 60 s after the first finish, at most 5 min
  board jsonb not null default '{}'::jsonb,    -- { "<player id>": { "<round>": {sorted,total,moves,penalty_ms,finished_ms,gave_up} } }
  left_by uuid,
  next_match uuid,                             -- the rematch, once someone asks for one
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check (cardinality(levels) = cardinality(seeds) and cardinality(levels) between 1 and 9),
  check (octet_length(board::text) <= 65536)
);
-- a code is only in use while its match is waiting or being played
create unique index if not exists minigame_matches_live_code on public.minigame_matches (code) where status in ('waiting', 'playing');
create index if not exists minigame_matches_host_idx on public.minigame_matches (host, created_at desc);
create index if not exists minigame_matches_guest_idx on public.minigame_matches (guest, created_at desc);

alter table public.minigame_matches enable row level security;
revoke all on public.minigame_matches from anon, authenticated;

-- ── internal helpers (not callable from the page) ──

-- move a match along: start the next round once this one is over, or finish the match
create or replace function public.minigame_match_tick(p_match uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare m minigame_matches; r text; both_out boolean;
begin
  select * into m from minigame_matches where id = p_match for update;
  if not found then return; end if;
  if m.status = 'waiting' and m.created_at < now() - interval '15 minutes' then
    update minigame_matches set status = 'expired' where id = m.id; return;
  end if;
  if m.status <> 'playing' or now() < m.round_start then return; end if;
  r := m.round::text;
  both_out := (select bool_and(coalesce((m.board -> p::text -> r ->> 'finished_ms') is not null, false)
                                or coalesce((m.board -> p::text -> r ->> 'gave_up')::boolean, false))
                 from unnest(array[m.host, m.guest]) p);
  if not both_out and now() < m.round_end then return; end if;
  if m.round + 1 < cardinality(m.levels) then
    -- a few seconds to see who won the round, then 3-2-1 for the next
    update minigame_matches set round = m.round + 1, round_start = now() + interval '8 seconds',
           round_end = now() + interval '8 seconds' + interval '5 minutes' where id = m.id;
  else
    update minigame_matches set status = 'done', finished_at = now() where id = m.id;
  end if;
end $$;
revoke all on function public.minigame_match_tick(uuid) from public, anon, authenticated;

-- what a phone sees: the match, both names, the server clock (to count down in step)
-- (volatile so it sees a row written earlier in the same call)
create or replace function public.minigame_match_view(p_match uuid)
returns jsonb language sql volatile security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'game', m.game, 'code', m.code, 'status', m.status, 'levels', to_jsonb(m.levels), 'seeds', to_jsonb(m.seeds),
    'round', m.round, 'round_start', m.round_start, 'round_end', m.round_end, 'board', m.board,
    'host', jsonb_build_object('id', h.id, 'name', h.name),
    'guest', case when g.id is null then null else jsonb_build_object('id', g.id, 'name', g.name) end,
    'left_by', m.left_by, 'next_match', m.next_match, 'finished_at', m.finished_at, 'now', now())
  from minigame_matches m join minigame_players h on h.id = m.host left join minigame_players g on g.id = m.guest
  where m.id = p_match
$$;
revoke all on function public.minigame_match_view(uuid) from public, anon, authenticated;

-- a new match, waiting for its second player (for a rematch the guest is already chosen: it starts
-- when that player says yes, so nobody starts a round while looking at another screen)
create or replace function public.minigame_match_new(p_host uuid, p_guest uuid, p_game text)
returns uuid language plpgsql volatile security definer set search_path = public, extensions as $$
declare v_code text; v_id uuid; i int;
begin
  -- the creator's older waiting matches are dropped
  update minigame_matches set status = 'expired' where status = 'waiting' and host = p_host;
  for i in 1..50 loop
    v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 24)::int, 1), '') from generate_series(1, 4));
    exit when not exists (select 1 from minigame_matches where code = v_code and status in ('waiting', 'playing'));
  end loop;
  insert into minigame_matches (game, code, host, guest, levels, seeds)
  values (p_game, v_code, p_host, p_guest, array[8, 12, 16, 20, 24],
          array(select floor(random() * 2000000000)::int from generate_series(1, 5)))
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.minigame_match_new(uuid, uuid, text) from public, anon, authenticated;

-- ── what the page calls ──

-- start a match and get its code; the other player joins with it
create or replace function public.minigame_match_create(p_token text, p_game text default 'pour')
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token);
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  return minigame_match_view(minigame_match_new(me, null, coalesce(p_game, 'pour')));
end $$;

-- join with a code: the match starts (3-2-1) as soon as you're in
create or replace function public.minigame_match_join(p_token text, p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token); m minigame_matches;
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  select * into m from minigame_matches where code = upper(btrim(coalesce(p_code, ''))) and status = 'waiting' for update;
  if not found or m.created_at < now() - interval '15 minutes' then return jsonb_build_object('ok', false, 'reason', 'no_match'); end if;
  if m.host = me then return jsonb_build_object('ok', false, 'reason', 'own_match'); end if;
  if m.guest is not null and m.guest <> me then return jsonb_build_object('ok', false, 'reason', 'no_match'); end if;
  update minigame_matches set guest = me, status = 'playing', round = 0,
         round_start = now() + interval '6 seconds', round_end = now() + interval '6 seconds' + interval '5 minutes'
   where id = m.id;
  return jsonb_build_object('ok', true, 'match', minigame_match_view(m.id));
end $$;

-- the match as it is now (moves it on to the next round when this one is over)
create or replace function public.minigame_match_state(p_token text, p_match uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token);
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  if not exists (select 1 from minigame_matches where id = p_match and me in (host, guest)) then
    raise exception 'Not your match' using errcode = '42501';
  end if;
  perform minigame_match_tick(p_match);
  return minigame_match_view(p_match);
end $$;

-- how this player is doing in the current round. Finishing is timed here; the phone only says how
-- much helper time to add. Reports for another round, before GO or after the round closes are ignored.
create or replace function public.minigame_match_report(p_token text, p_match uuid, p_round int, p_sorted int, p_total int,
  p_moves int, p_penalty_ms int, p_finished boolean, p_gave_up boolean)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token); m minigame_matches; cur jsonb; ms int;
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  perform minigame_match_tick(p_match);
  select * into m from minigame_matches where id = p_match for update;
  if not found or me not in (m.host, coalesce(m.guest, m.host)) then raise exception 'Not your match' using errcode = '42501'; end if;
  if m.status = 'playing' and p_round = m.round and now() >= m.round_start and now() < m.round_end then
    cur := coalesce(m.board -> me::text -> p_round::text, '{}'::jsonb);
    -- once finished or given up, that round's result is fixed
    if (cur ->> 'finished_ms') is null and not coalesce((cur ->> 'gave_up')::boolean, false) then
      ms := case when p_finished then (extract(epoch from now() - m.round_start) * 1000)::int end;
      cur := jsonb_build_object(
        'sorted', greatest(0, least(coalesce(p_sorted, 0), 20)), 'total', greatest(0, least(coalesce(p_total, 0), 20)),
        'moves', greatest(0, least(coalesce(p_moves, 0), 10000)),
        'penalty_ms', greatest(coalesce((cur ->> 'penalty_ms')::int, 0), least(coalesce(p_penalty_ms, 0), 3600000)),
        'finished_ms', ms, 'gave_up', coalesce(p_gave_up, false) and not coalesce(p_finished, false));
      update minigame_matches
         set board = jsonb_set(case when board ? me::text then board else board || jsonb_build_object(me::text, '{}'::jsonb) end,
                               array[me::text, p_round::text], cur),
             -- the first one home gives the other 60 seconds
             round_end = case when ms is not null then least(round_end, now() + interval '60 seconds') else round_end end
       where id = m.id;
      perform minigame_match_tick(p_match);
    end if;
  end if;
  return minigame_match_view(p_match);
end $$;

-- leave a match part way (the other player sees that you left)
create or replace function public.minigame_match_leave(p_token text, p_match uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token);
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  update minigame_matches set status = case when status = 'waiting' then 'expired' else 'left' end, left_by = me, finished_at = now()
   where id = p_match and me in (host, guest) and status in ('waiting', 'playing');
end $$;

-- play again: whoever asks first makes one new match for the same two players and waits; the
-- other phone sees next_match, and when that player asks too it starts (3-2-1)
create or replace function public.minigame_match_rematch(p_token text, p_match uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token); m minigame_matches; v_new uuid;
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  select * into m from minigame_matches where id = p_match and me in (host, guest) for update;
  if not found then raise exception 'Not your match' using errcode = '42501'; end if;
  if m.guest is null or m.status not in ('done', 'left') then return jsonb_build_object('ok', false, 'reason', 'not_finished'); end if;
  if m.next_match is null then
    v_new := minigame_match_new(me, case when me = m.host then m.guest else m.host end, m.game);
    update minigame_matches set next_match = v_new where id = m.id;
  else
    v_new := m.next_match;
    update minigame_matches set status = 'playing', round = 0,
           round_start = now() + interval '6 seconds', round_end = now() + interval '6 seconds' + interval '5 minutes'
     where id = v_new and guest = me and status = 'waiting';
  end if;
  return jsonb_build_object('ok', true, 'match', minigame_match_view(v_new));
end $$;

-- this player's finished matches (newest first), for the head-to-head record
create or replace function public.minigame_match_history(p_token text, p_game text default 'pour')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token);
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(minigame_match_view(id) order by finished_at desc)
    from (select id, finished_at from minigame_matches
           where me in (host, guest) and game = coalesce(p_game, 'pour') and status = 'done'
           order by finished_at desc limit 100) x), '[]'::jsonb);
end $$;

revoke all on function public.minigame_match_create(text, text), public.minigame_match_join(text, text),
  public.minigame_match_state(text, uuid), public.minigame_match_report(text, uuid, int, int, int, int, int, boolean, boolean),
  public.minigame_match_leave(text, uuid), public.minigame_match_rematch(text, uuid), public.minigame_match_history(text, text) from public;
grant execute on function public.minigame_match_create(text, text), public.minigame_match_join(text, text),
  public.minigame_match_state(text, uuid), public.minigame_match_report(text, uuid, int, int, int, int, int, boolean, boolean),
  public.minigame_match_leave(text, uuid), public.minigame_match_rematch(text, uuid), public.minigame_match_history(text, text) to anon, authenticated;

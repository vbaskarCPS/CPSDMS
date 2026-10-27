-- Minigame "Match" (memory cards, propertystars.app/minigame/match): two players take turns on one
-- shared board, flipping two cards a turn. A pair stays up for whoever found it and they go again;
-- a miss shows both cards for 1.5 s, then they flip back and the turn passes. 20 s to flip or the
-- turn passes. A match is best of 3 boards (8, 12, 15 pairs); first turn alternates by board.
--
-- Where the cards are is kept here and never sent to the phones: a card's picture is only sent
-- once it has been flipped. The phones check in about twice a second (minigame_memory_state).
--
-- Additive only. The table is closed to the public key (RLS on, no grants); the page reaches it
-- only through the minigame_memory_* functions, which need a player's pass token.

create table if not exists public.minigame_memory (
  id uuid primary key default gen_random_uuid(),
  code text not null check (code ~ '^[A-Z]{4}$'),
  host uuid not null references public.minigame_players(id) on delete cascade,
  guest uuid references public.minigame_players(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'done', 'left', 'expired')),
  sizes int[] not null default array[8, 12, 15],   -- pairs on each board
  board_no int not null default 0,                 -- 0-based
  deck int[] not null default '{}',                -- picture number on each card (secret)
  owner int[] not null default '{}',               -- who found each card: 0 nobody, 1 host, 2 guest
  turn uuid,                                       -- whose turn it is
  first_pick int,                                  -- the first card flipped this turn (0-based)
  second_pick int,                                 -- a miss being shown
  reveal_until timestamptz,                        -- when the miss flips back
  pause_until timestamptz,                         -- the count-in before a board (and after the last one)
  turn_deadline timestamptz,
  boards jsonb not null default '[]'::jsonb,       -- finished boards: [{"host": 5, "guest": 3}, ...]
  last jsonb,                                      -- the latest flip pair, so the watching phone can show it
  version int not null default 0,
  left_by uuid,
  next_match uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create unique index if not exists minigame_memory_live_code on public.minigame_memory (code) where status in ('waiting', 'playing');
create index if not exists minigame_memory_host_idx on public.minigame_memory (host, created_at desc);
create index if not exists minigame_memory_guest_idx on public.minigame_memory (guest, created_at desc);

alter table public.minigame_memory enable row level security;
revoke all on public.minigame_memory from anon, authenticated;

-- ── internal helpers (not callable from the page) ──

-- a shuffled deck: n pairs of n different pictures out of 18
create or replace function public.minigame_memory_deal(p_pairs int)
returns int[] language sql volatile security definer set search_path = public as $$
  with pics as (select p from generate_series(0, 17) p order by random() limit p_pairs)
  select array_agg(p order by random()) from (select p from pics union all select p from pics) x
$$;
revoke all on function public.minigame_memory_deal(int) from public, anon, authenticated;

-- start board n: new deck, nobody's cards, the right player starts (host on boards 1 and 3)
create or replace function public.minigame_memory_board(p_id uuid, p_board int)
returns void language plpgsql volatile security definer set search_path = public as $$
declare m minigame_memory; pairs int;
begin
  select * into m from minigame_memory where id = p_id;
  pairs := m.sizes[p_board + 1];
  update minigame_memory set board_no = p_board, deck = minigame_memory_deal(pairs), owner = array_fill(0, array[pairs * 2]),
         turn = case when p_board % 2 = 0 then m.host else m.guest end, first_pick = null, second_pick = null, reveal_until = null,
         pause_until = now() + interval '4 seconds', turn_deadline = now() + interval '24 seconds', last = null, version = m.version + 1
   where id = p_id;
end $$;
revoke all on function public.minigame_memory_board(uuid, int) from public, anon, authenticated;

-- move things along: a shown miss flips back, a slow turn passes, a waiting code expires
create or replace function public.minigame_memory_tick(p_id uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare m minigame_memory;
begin
  select * into m from minigame_memory where id = p_id for update;
  if not found then return; end if;
  if m.status = 'waiting' and m.created_at < now() - interval '15 minutes' then
    update minigame_memory set status = 'expired', version = m.version + 1 where id = m.id; return;
  end if;
  if m.status <> 'playing' then return; end if;
  if m.second_pick is not null and now() >= m.reveal_until then
    update minigame_memory set first_pick = null, second_pick = null, reveal_until = null,
           turn = case when m.turn = m.host then m.guest else m.host end, turn_deadline = now() + interval '20 seconds', version = m.version + 1
     where id = m.id;
  elsif m.second_pick is null and now() >= m.turn_deadline then
    update minigame_memory set first_pick = null,
           turn = case when m.turn = m.host then m.guest else m.host end, turn_deadline = now() + interval '20 seconds',
           last = jsonb_build_object('timeout', true, 'by', m.turn), version = m.version + 1
     where id = m.id;
  end if;
end $$;
revoke all on function public.minigame_memory_tick(uuid) from public, anon, authenticated;

-- what a phone sees: every card face down unless it's been found or is flipped right now
-- (volatile so it sees a row written earlier in the same call)
create or replace function public.minigame_memory_view(p_id uuid)
returns jsonb language sql volatile security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'code', m.code, 'status', m.status, 'sizes', to_jsonb(m.sizes), 'board_no', m.board_no,
    'cards', coalesce((select jsonb_agg(jsonb_build_object(
                 'face', case when m.owner[i] <> 0 or i - 1 = m.first_pick or i - 1 = m.second_pick then m.deck[i] end,
                 'owner', m.owner[i]) order by i)
               from generate_subscripts(m.deck, 1) i), '[]'::jsonb),
    'turn', m.turn, 'first_pick', m.first_pick, 'second_pick', m.second_pick,
    'reveal_until', m.reveal_until, 'pause_until', m.pause_until, 'turn_deadline', m.turn_deadline,
    'boards', m.boards, 'last', m.last, 'version', m.version,
    'host', jsonb_build_object('id', h.id, 'name', h.name),
    'guest', case when g.id is null then null else jsonb_build_object('id', g.id, 'name', g.name) end,
    'left_by', m.left_by, 'next_match', m.next_match, 'finished_at', m.finished_at, 'now', now())
  from minigame_memory m join minigame_players h on h.id = m.host left join minigame_players g on g.id = m.guest
  where m.id = p_id
$$;
revoke all on function public.minigame_memory_view(uuid) from public, anon, authenticated;

-- a new match, waiting for its second player (a rematch already knows who that is)
create or replace function public.minigame_memory_new(p_host uuid, p_guest uuid)
returns uuid language plpgsql volatile security definer set search_path = public as $$
declare v_code text; v_id uuid; i int;
begin
  update minigame_memory set status = 'expired' where status = 'waiting' and host = p_host;
  for i in 1..50 loop
    v_code := (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 24)::int, 1), '') from generate_series(1, 4));
    exit when not exists (select 1 from minigame_memory where code = v_code and status in ('waiting', 'playing'));
  end loop;
  insert into minigame_memory (code, host, guest) values (v_code, p_host, p_guest) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.minigame_memory_new(uuid, uuid) from public, anon, authenticated;

-- ── what the page calls ──

create or replace function public.minigame_memory_create(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token);
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  return minigame_memory_view(minigame_memory_new(me, null));
end $$;

create or replace function public.minigame_memory_join(p_token text, p_code text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token); m minigame_memory;
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  select * into m from minigame_memory where code = upper(btrim(coalesce(p_code, ''))) and status = 'waiting' for update;
  if not found or m.created_at < now() - interval '15 minutes' then return jsonb_build_object('ok', false, 'reason', 'no_match'); end if;
  if m.host = me then return jsonb_build_object('ok', false, 'reason', 'own_match'); end if;
  if m.guest is not null and m.guest <> me then return jsonb_build_object('ok', false, 'reason', 'no_match'); end if;
  update minigame_memory set guest = me, status = 'playing' where id = m.id;
  perform minigame_memory_board(m.id, 0);
  return jsonb_build_object('ok', true, 'match', minigame_memory_view(m.id));
end $$;

create or replace function public.minigame_memory_state(p_token text, p_match uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token);
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  if not exists (select 1 from minigame_memory where id = p_match and me in (host, guest)) then
    raise exception 'Not your match' using errcode = '42501';
  end if;
  perform minigame_memory_tick(p_match);
  return minigame_memory_view(p_match);
end $$;

-- flip a card (0-based). Only on your turn, a face-down card, not while a miss is showing or the
-- board is counting in. Returns the match either way, so the phone always shows the truth.
create or replace function public.minigame_memory_flip(p_token text, p_match uuid, p_card int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token); m minigame_memory; side int; a int; done boolean;
  hs int; gs int; v_boards jsonb; wins_h int; wins_g int;
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  perform minigame_memory_tick(p_match);
  select * into m from minigame_memory where id = p_match for update;
  if not found or me not in (m.host, coalesce(m.guest, m.host)) then raise exception 'Not your match' using errcode = '42501'; end if;
  if m.status <> 'playing' or m.turn <> me or now() < m.pause_until or m.second_pick is not null
     or p_card is null or p_card < 0 or p_card >= cardinality(m.deck) or m.owner[p_card + 1] <> 0 or p_card = m.first_pick then
    return minigame_memory_view(p_match);
  end if;
  side := case when me = m.host then 1 else 2 end;
  if m.first_pick is null then
    update minigame_memory set first_pick = p_card, turn_deadline = now() + interval '20 seconds',
           last = jsonb_build_object('a', p_card, 'by', me), version = m.version + 1 where id = m.id;
    return minigame_memory_view(p_match);
  end if;
  a := m.first_pick;
  if m.deck[a + 1] <> m.deck[p_card + 1] then
    -- a miss: show both for a moment, then the turn passes (minigame_memory_tick)
    update minigame_memory set second_pick = p_card, reveal_until = now() + interval '1.5 seconds',
           last = jsonb_build_object('a', a, 'b', p_card, 'fa', m.deck[a + 1], 'fb', m.deck[p_card + 1], 'match', false, 'by', me),
           version = m.version + 1 where id = m.id;
    return minigame_memory_view(p_match);
  end if;
  -- a pair: it's theirs, and they go again
  m.owner[a + 1] := side; m.owner[p_card + 1] := side;
  done := not (0 = any(m.owner));
  update minigame_memory set owner = m.owner, first_pick = null, turn_deadline = now() + interval '20 seconds',
         last = jsonb_build_object('a', a, 'b', p_card, 'fa', m.deck[a + 1], 'fb', m.deck[p_card + 1], 'match', true, 'by', me),
         version = m.version + 1 where id = m.id;
  if done then
    hs := (select count(*) from unnest(m.owner) o where o = 1) / 2;
    gs := (select count(*) from unnest(m.owner) o where o = 2) / 2;
    v_boards := m.boards || jsonb_build_array(jsonb_build_object('host', hs, 'guest', gs));
    wins_h := (select count(*) from jsonb_array_elements(v_boards) b where (b->>'host')::int > (b->>'guest')::int);
    wins_g := (select count(*) from jsonb_array_elements(v_boards) b where (b->>'guest')::int > (b->>'host')::int);
    update minigame_memory set boards = v_boards where id = m.id;
    -- best of 3: over once someone has 2 boards, or after the third
    if m.board_no + 1 >= cardinality(m.sizes) or wins_h >= 2 or wins_g >= 2 then
      update minigame_memory set status = 'done', finished_at = now(), turn = null, version = version + 1 where id = m.id;
    else
      perform minigame_memory_board(m.id, m.board_no + 1);
      -- a little longer before the next board, to see who won this one
      update minigame_memory set pause_until = now() + interval '6 seconds', turn_deadline = now() + interval '26 seconds' where id = m.id;
    end if;
  end if;
  return minigame_memory_view(p_match);
end $$;

create or replace function public.minigame_memory_leave(p_token text, p_match uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token);
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  update minigame_memory set status = case when status = 'waiting' then 'expired' else 'left' end, left_by = me,
         finished_at = now(), version = version + 1
   where id = p_match and me in (host, guest) and status in ('waiting', 'playing');
end $$;

-- play again: whoever asks first makes the new match and waits; it starts when the other asks too
create or replace function public.minigame_memory_rematch(p_token text, p_match uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token); m minigame_memory; v_new uuid;
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  select * into m from minigame_memory where id = p_match and me in (host, guest) for update;
  if not found then raise exception 'Not your match' using errcode = '42501'; end if;
  if m.guest is null or m.status not in ('done', 'left') then return jsonb_build_object('ok', false, 'reason', 'not_finished'); end if;
  if m.next_match is null then
    v_new := minigame_memory_new(me, case when me = m.host then m.guest else m.host end);
    update minigame_memory set next_match = v_new, version = version + 1 where id = m.id;
  else
    v_new := m.next_match;
    if exists (select 1 from minigame_memory where id = v_new and guest = me and status = 'waiting') then
      update minigame_memory set status = 'playing' where id = v_new;
      perform minigame_memory_board(v_new, 0);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'match', minigame_memory_view(v_new));
end $$;

-- this player's finished matches (newest first), for the head-to-head record
create or replace function public.minigame_memory_history(p_token text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare me uuid := minigame_player_of(p_token);
begin
  if me is null then raise exception 'Sign in to play' using errcode = '28000'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'host', jsonb_build_object('id', h.id, 'name', h.name),
                     'guest', jsonb_build_object('id', g.id, 'name', g.name), 'boards', m.boards, 'finished_at', m.finished_at) order by m.finished_at desc)
    from (select * from minigame_memory where me in (host, guest) and status = 'done' order by finished_at desc limit 100) m
    join minigame_players h on h.id = m.host join minigame_players g on g.id = m.guest), '[]'::jsonb);
end $$;

revoke all on function public.minigame_memory_create(text), public.minigame_memory_join(text, text), public.minigame_memory_state(text, uuid),
  public.minigame_memory_flip(text, uuid, int), public.minigame_memory_leave(text, uuid), public.minigame_memory_rematch(text, uuid),
  public.minigame_memory_history(text) from public;
grant execute on function public.minigame_memory_create(text), public.minigame_memory_join(text, text), public.minigame_memory_state(text, uuid),
  public.minigame_memory_flip(text, uuid, int), public.minigame_memory_leave(text, uuid), public.minigame_memory_rematch(text, uuid),
  public.minigame_memory_history(text) to anon, authenticated;

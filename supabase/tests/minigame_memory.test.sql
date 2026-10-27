-- Minigame Match (memory cards): create / join, the deck kept secret, turns, pairs and misses,
-- the 20-second turn limit, boards and best of 3, leaving, rematch, history, and the table closed to
-- the public key. Run after the accounts migration and this one (psql -v mig=... -v mig3=...);
-- everything is rolled back.
\set ON_ERROR_STOP 1
begin;
\i :mig
\i :mig3

-- test helper: the two cards (0-based) of picture p on the current board, that nobody has found yet
create function pg_temp.pair_of(p_id uuid) returns int[] language sql as $$
  select array_agg(i - 1 order by i) from (
    select i, deck[i] d from minigame_memory, generate_subscripts(deck, 1) i where id = p_id and owner[i] = 0
  ) x where d = (select deck[j] from minigame_memory, generate_subscripts(deck, 1) j where id = p_id and owner[j] = 0 order by j limit 1)
$$;
-- and two face-down cards that don't match
create function pg_temp.miss_of(p_id uuid) returns int[] language sql as $$
  select array[a - 1, b - 1] from minigame_memory m, generate_subscripts(m.deck, 1) a, generate_subscripts(m.deck, 1) b
   where m.id = p_id and m.owner[a] = 0 and m.owner[b] = 0 and m.deck[a] <> m.deck[b] order by a, b limit 1
$$;
create function pg_temp.go(p_id uuid) returns void language sql as $$
  update minigame_memory set pause_until = now() - interval '1 second', turn_deadline = now() + interval '20 seconds' where id = p_id
$$;

do $$
declare v uuid; r uuid; tv text; tr text; s jsonb; mid uuid; code text; c int[]; t text; who text; i int; nid uuid;
begin
  select id into v from minigame_players where name = 'Vijay';
  select id into r from minigame_players where name = 'Rosh';
  tv := minigame_sign_in(v, '1234')->>'token';
  tr := minigame_sign_in(r, '5678')->>'token';

  s := minigame_memory_create(tv); mid := (s->>'id')::uuid; code := s->>'code';
  assert code ~ '^[A-Z]{4}$' and s->>'status' = 'waiting', 'waiting with a code';
  assert minigame_memory_join(tv, code)->>'reason' = 'own_match', 'not your own';
  s := minigame_memory_join(tr, lower(code));
  assert s->>'ok' = 'true' and s->'match'->>'status' = 'playing', 'Rosh joined';
  s := s->'match';
  assert jsonb_array_length(s->'cards') = 16, 'board 1: 8 pairs';
  assert not exists (select 1 from jsonb_array_elements(s->'cards') x where x->>'face' is not null), 'every card face down: the deck is not sent';
  assert not (s ? 'deck'), 'no deck in the view';
  assert s->>'turn' = v::text, 'the host starts board 1';
  assert (select count(distinct d) from minigame_memory, unnest(deck) d where id = mid) = 8, '8 different pictures';
  assert (select bool_and(n = 2) from (select count(*) n from minigame_memory, unnest(deck) d where id = mid group by d) x), 'each twice';

  -- nothing before the count-in ends, and not on the other player's turn
  s := minigame_memory_flip(tv, mid, 0);
  assert s->>'first_pick' is null, 'no flips during the count-in';
  perform pg_temp.go(mid);
  s := minigame_memory_flip(tr, mid, 0);
  assert s->>'first_pick' is null, 'not Rosh''s turn';

  -- a pair: it's Vijay's and he goes again
  c := pg_temp.pair_of(mid);
  s := minigame_memory_flip(tv, mid, c[1]);
  assert s->>'first_pick' = c[1]::text and s->'cards'->c[1]->>'face' is not null, 'first card shown';
  assert (select count(*) from jsonb_array_elements(s->'cards') x where x->>'face' is not null) = 1, 'only that card shown';
  s := minigame_memory_flip(tv, mid, c[1]);
  assert s->>'first_pick' = c[1]::text and s->>'second_pick' is null, 'the same card twice does nothing';
  s := minigame_memory_flip(tv, mid, c[2]);
  assert s->'cards'->c[1]->>'owner' = '1' and s->'cards'->c[2]->>'owner' = '1', 'pair is Vijay''s';
  assert s->>'turn' = v::text and s->'last'->>'match' = 'true', 'Vijay goes again';

  -- a miss: both shown, then the turn passes after 1.5 s
  c := pg_temp.miss_of(mid);
  perform minigame_memory_flip(tv, mid, c[1]);
  s := minigame_memory_flip(tv, mid, c[2]);
  assert s->>'second_pick' = c[2]::text and s->'cards'->c[2]->>'face' is not null and s->'last'->>'match' = 'false', 'miss shown';
  s := minigame_memory_flip(tv, mid, (select min(k) - 1 from minigame_memory, generate_subscripts(owner, 1) k where id = mid and owner[k] = 0 and k - 1 not in (c[1], c[2])));
  assert s->>'second_pick' = c[2]::text, 'no flips while a miss is showing';
  s := minigame_memory_state(tr, mid);
  assert s->>'turn' = v::text, 'still showing';
  update minigame_memory set reveal_until = now() - interval '1 ms' where id = mid;
  s := minigame_memory_state(tr, mid);
  assert s->>'turn' = r::text and s->>'second_pick' is null and s->'cards'->c[1]->>'face' is null, 'flipped back, Rosh''s turn';

  -- too slow: the turn passes
  perform minigame_memory_flip(tr, mid, (pg_temp.miss_of(mid))[1]);
  update minigame_memory set turn_deadline = now() - interval '1 ms' where id = mid;
  s := minigame_memory_state(tv, mid);
  assert s->>'turn' = v::text and s->>'first_pick' is null and s->'last'->>'timeout' = 'true', 'Rosh ran out of time';

  -- Vijay clears board 1 (he has every pair)
  while exists (select 1 from minigame_memory where id = mid and board_no = 0 and 0 = any(owner)) loop
    c := pg_temp.pair_of(mid);
    perform minigame_memory_flip(tv, mid, c[1]); s := minigame_memory_flip(tv, mid, c[2]);
  end loop;
  assert s->'boards' = '[{"host": 8, "guest": 0}]'::jsonb, 'board 1: 8–0';
  assert s->>'board_no' = '1' and jsonb_array_length(s->'cards') = 24 and s->>'turn' = r::text, 'board 2: 12 pairs, Rosh starts';
  assert (s->>'pause_until')::timestamptz > now() + interval '4 seconds', 'a pause to see who won';

  -- board 2: Vijay again (Rosh misses first) → 2 boards, match over early
  perform pg_temp.go(mid);
  c := pg_temp.miss_of(mid);
  perform minigame_memory_flip(tr, mid, c[1]); perform minigame_memory_flip(tr, mid, c[2]);
  update minigame_memory set reveal_until = now() - interval '1 ms' where id = mid;
  perform minigame_memory_state(tv, mid);
  while exists (select 1 from minigame_memory where id = mid and board_no = 1 and 0 = any(owner)) loop
    c := pg_temp.pair_of(mid);
    perform minigame_memory_flip(tv, mid, c[1]); s := minigame_memory_flip(tv, mid, c[2]);
  end loop;
  assert s->>'status' = 'done' and jsonb_array_length(s->'boards') = 2, 'best of 3: over after 2–0';
  assert (select count(*) from jsonb_array_elements(s->'cards') x where x->>'face' is null) = 0, 'all cards shown at the end';

  -- history, rematch (waits for both), leave
  assert jsonb_array_length(minigame_memory_history(tr)) = 1 and minigame_memory_history(tv)->0->'boards' = s->'boards', 'in history';
  s := minigame_memory_rematch(tr, mid); nid := (s->'match'->>'id')::uuid;
  assert s->'match'->>'status' = 'waiting' and s->'match'->'guest'->>'name' = 'Vijay', 'rematch waits';
  assert minigame_memory_state(tv, mid)->>'next_match' = nid::text, 'Vijay sees it';
  s := minigame_memory_rematch(tv, mid);
  assert s->'match'->>'id' = nid::text and s->'match'->>'status' = 'playing' and s->'match'->>'turn' = r::text, 'started; Rosh (host) starts';
  perform minigame_memory_leave(tv, nid);
  s := minigame_memory_state(tr, nid);
  assert s->>'status' = 'left' and s->>'left_by' = v::text, 'Vijay left';

  -- a tie board doesn't count as a win; the third board decides
  s := minigame_memory_create(tv); mid := (s->>'id')::uuid; perform minigame_memory_join(tr, s->>'code');
  for i in 0..2 loop
    perform pg_temp.go(mid);
    while exists (select 1 from minigame_memory where id = mid and board_no = i and status = 'playing' and 0 = any(owner)) loop
      who := (select turn::text from minigame_memory where id = mid);
      t := case when who = v::text then tv else tr end;
      c := pg_temp.pair_of(mid);
      perform minigame_memory_flip(t, mid, c[1]); s := minigame_memory_flip(t, mid, c[2]);
      -- hand the turn over after every pair so the boards come out close
      if (select status from minigame_memory where id = mid) = 'playing' and (select board_no from minigame_memory where id = mid) = i then
        c := pg_temp.miss_of(mid);
        if c is not null then
          perform minigame_memory_flip(t, mid, c[1]); perform minigame_memory_flip(t, mid, c[2]);
          update minigame_memory set reveal_until = now() - interval '1 ms' where id = mid; perform minigame_memory_tick(mid);
        end if;
      end if;
    end loop;
  end loop;
  assert s->>'status' = 'done' and jsonb_array_length(s->'boards') = 3, 'close boards: all 3 played';
end $$;

set local role anon;
do $$ begin
  begin perform 1 from public.minigame_memory; assert false, 'anon read the table'; exception when insufficient_privilege then null; end;
  begin perform public.minigame_memory_deal(8); assert false, 'anon dealt'; exception when insufficient_privilege then null; end;
  begin perform public.minigame_memory_view(gen_random_uuid()); assert false, 'anon viewed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
\echo 'minigame memory: all good'
rollback;

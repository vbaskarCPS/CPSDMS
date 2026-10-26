-- Minigame matches (Pour PvP): create / join by code, server-timed finishes, the 60-second cutoff,
-- giving up, moving through the rounds, leaving, rematch and history, and the table closed to the
-- public key. Run after both minigame migrations (psql -v mig=... -v mig2=...); everything is rolled back.
\set ON_ERROR_STOP 1
begin;
\i :mig
\i :mig2

do $$
declare v uuid; r uuid; tv text; tr text; s jsonb; mid uuid; code text; m minigame_matches; i int; nid uuid;
begin
  select id into v from minigame_players where name = 'Vijay';
  select id into r from minigame_players where name = 'Rosh';
  tv := minigame_sign_in(v, '1234')->>'token';
  tr := minigame_sign_in(r, '5678')->>'token';

  -- create: a 4-letter code, waiting, five rounds getting bigger
  s := minigame_match_create(tv);
  mid := (s->>'id')::uuid; code := s->>'code';
  assert code ~ '^[A-Z]{4}$' and code !~ '[IO]', 'a 4-letter code without I or O';
  assert s->>'status' = 'waiting' and s->'guest' = 'null'::jsonb, 'waiting for the other player';
  assert s->'levels' = '[8,12,16,20,24]'::jsonb and jsonb_array_length(s->'seeds') = 5, 'five rounds, harder each time';
  begin perform minigame_match_create('nope'); assert false, 'created without a pass'; exception when sqlstate '28000' then null; end;

  -- join: not your own, not a wrong code; lower case and spaces are fine
  assert minigame_match_join(tv, code)->>'reason' = 'own_match', 'cannot join your own match';
  assert minigame_match_join(tr, 'ZZZZ')->>'reason' = 'no_match', 'wrong code';
  s := minigame_match_join(tr, ' ' || lower(code) || ' ');
  assert s->>'ok' = 'true' and s->'match'->>'status' = 'playing' and s->'match'->'guest'->>'name' = 'Rosh', 'Rosh joined';
  assert (s->'match'->>'round_start')::timestamptz > now(), 'a countdown before GO';
  assert minigame_match_join(tr, code)->>'reason' = 'no_match', 'a match can only be joined once';

  -- only the two players can see it
  insert into minigame_players (name) values ('Kiaan');
  begin perform minigame_match_state(minigame_sign_in((select id from minigame_players where name = 'Kiaan'), '0000')->>'token', mid);
    assert false, 'someone else saw the match'; exception when sqlstate '42501' then null; end;

  -- reports before GO are ignored
  s := minigame_match_report(tv, mid, 0, 1, 5, 3, 0, false, false);
  assert s->'board' = '{}'::jsonb, 'nothing counts before GO';

  -- GO: progress counts; finishing is timed on the server, from GO
  update minigame_matches set round_start = now() - interval '30 seconds', round_end = now() + interval '270 seconds' where id = mid;
  s := minigame_match_report(tv, mid, 0, 2, 5, 6, 2000, false, false);
  assert s->'board'->v::text->'0'->>'sorted' = '2' and s->'board'->v::text->'0'->>'penalty_ms' = '2000', 'progress and helper time saved';
  s := minigame_match_report(tv, mid, 0, 5, 5, 14, 1000, true, false);   -- penalty never goes down
  assert (s->'board'->v::text->'0'->>'finished_ms')::int between 29000 and 31500, 'finish timed from GO';
  assert s->'board'->v::text->'0'->>'penalty_ms' = '2000', 'helper time never goes down';
  assert (s->>'round_end')::timestamptz <= now() + interval '61 seconds', 'the other player now has 60 seconds';
  s := minigame_match_report(tv, mid, 0, 0, 5, 99, 0, false, true);
  assert s->'board'->v::text->'0'->>'moves' = '14' and s->'board'->v::text->'0'->>'gave_up' = 'false', 'a finished round is fixed';
  assert s->>'round' = '0', 'still round 1 while Rosh plays';
  -- reports for the wrong round are ignored
  s := minigame_match_report(tr, mid, 3, 5, 5, 1, 0, true, false);
  assert not (s->'board' ? r::text), 'wrong round ignored';

  -- Rosh finishes too: the round is over, round 2 counts down
  s := minigame_match_report(tr, mid, 0, 5, 5, 11, 0, true, false);
  assert s->>'round' = '1' and (s->>'round_start')::timestamptz > now(), 'on to round 2, after a pause';
  assert s->'board'->r::text->'0'->>'moves' = '11', 'Rosh''s round 1 kept';

  -- round 2: Vijay gives up; Rosh runs out of time
  update minigame_matches set round_start = now() - interval '10 seconds', round_end = now() + interval '290 seconds' where id = mid;
  s := minigame_match_report(tv, mid, 1, 1, 6, 4, 0, false, true);
  assert s->'board'->v::text->'1'->>'gave_up' = 'true' and s->>'round' = '1', 'gave up; Rosh still playing';
  update minigame_matches set round_end = now() - interval '1 second' where id = mid;
  s := minigame_match_report(tr, mid, 1, 6, 6, 20, 0, true, false);   -- too late
  assert s->>'round' = '2' and s->'board'->r::text->'1' is null, 'late finish ignored, next round';

  -- rounds 3–5: both finish each one; then the match is done
  for i in 2..4 loop
    update minigame_matches set round_start = now() - interval '20 seconds', round_end = now() + interval '280 seconds' where id = mid;
    perform minigame_match_report(tv, mid, i, 9, 9, 30, 0, true, false);
    s := minigame_match_report(tr, mid, i, 9, 9, 28, 5000, true, false);
  end loop;
  assert s->>'status' = 'done' and s->>'finished_at' is not null, 'match over after round 5';
  assert s->'board'->r::text->'4'->>'penalty_ms' = '5000', 'last round saved';

  -- history (both see it), and a rematch both phones end up in
  assert jsonb_array_length(minigame_match_history(tv)) = 1 and jsonb_array_length(minigame_match_history(tr)) = 1, 'in both histories';
  s := minigame_match_rematch(tr, mid);
  nid := (s->'match'->>'id')::uuid;
  assert s->'match'->>'status' = 'waiting' and s->'match'->'host'->>'name' = 'Rosh' and s->'match'->'guest'->>'name' = 'Vijay', 'rematch waits for Vijay';
  assert (minigame_match_rematch(tr, mid)->'match'->>'status') = 'waiting', 'asking twice does not start it';
  assert minigame_match_join(minigame_sign_in((select id from minigame_players where name = 'Kiaan'), '0000')->>'token', s->'match'->>'code')->>'reason' = 'no_match', 'nobody else can take the rematch';
  assert minigame_match_state(tv, mid)->>'next_match' = nid::text, 'the old match points to the rematch';
  s := minigame_match_rematch(tv, mid);
  assert (s->'match'->>'id')::uuid = nid and s->'match'->>'status' = 'playing', 'Vijay says yes: it starts';

  -- leaving: the other player sees who left, and it isn't in history
  perform minigame_match_leave(tv, nid);
  s := minigame_match_state(tr, nid);
  assert s->>'status' = 'left' and s->>'left_by' = v::text, 'Vijay left';
  assert jsonb_array_length(minigame_match_history(tr)) = 1, 'left matches are not in the record';

  -- a waiting match expires after 15 minutes, and making a new one drops your old waiting one
  s := minigame_match_create(tv); mid := (s->>'id')::uuid;
  s := minigame_match_create(tv);
  assert (select status from minigame_matches where id = mid) = 'expired', 'old waiting match dropped';
  update minigame_matches set created_at = now() - interval '16 minutes' where id = (s->>'id')::uuid;
  assert minigame_match_join(tr, s->>'code')->>'reason' = 'no_match', 'stale code refused';
end $$;

-- the public key can't touch the table, only call the functions
set local role anon;
do $$ begin
  begin perform 1 from public.minigame_matches; assert false, 'anon read the table'; exception when insufficient_privilege then null; end;
  begin perform public.minigame_match_tick(gen_random_uuid()); assert false, 'anon called tick'; exception when insufficient_privilege then null; end;
  begin perform public.minigame_match_new(gen_random_uuid(), null, 'pour'); assert false, 'anon called new'; exception when insufficient_privilege then null; end;
end $$;
reset role;

\echo 'minigame matches: all good'
rollback;

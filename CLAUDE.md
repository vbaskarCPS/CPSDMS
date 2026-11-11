# Notes for Claude

- Rep app (src/v2/features/rep): every change a rep will notice gets a "What's new" entry at the top of `UPDATES` in
  `src/v2/features/rep/WhatsNew.tsx` (new unique id, short steps, a small picture when it helps), in the same PR.
  Reps see it once, the first time they open the app after the update.
- Planner (src/planner): every change Vijay or Rosh will notice gets an entry at the top of `src/planner/news.json`
  (new unique id, today's date, a short title, one to four short lines; `"for": "morning"` or `"night"` when it is only
  for one of them), in the same PR. Arvy posts it in its chat after the update and a notification goes out.

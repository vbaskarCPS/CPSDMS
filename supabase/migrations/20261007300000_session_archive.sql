-- A private place to keep a copy of a finished day before the old app's session is cleared.
-- The old app holds one day at a time per center, so a day must be cleared before the next
-- one starts; this keeps the cleared rows "in case". Additive only.
--
-- Rows are stored as JSON so the copy survives later column changes. Passwords and card
-- fields are never copied (see scripts/2026-10-07_close_oct06_session.sql).
-- The "archive" schema is not exposed through the API and no app role can read it.
create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;

create table if not exists archive.session_rows (
  id           bigint generated always as identity primary key,
  day          date        not null,
  center_id    uuid        not null,
  source_table text        not null,
  row_data     jsonb       not null,
  archived_at  timestamptz not null default now()
);
create index if not exists session_rows_day_center on archive.session_rows (center_id, day, source_table);

alter table archive.session_rows enable row level security;
revoke all on archive.session_rows from public, anon, authenticated;

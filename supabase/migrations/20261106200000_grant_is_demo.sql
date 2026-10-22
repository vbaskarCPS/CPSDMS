-- command_centers is read column by column (the password column is never granted). The new is_demo
-- column was never granted, so every centre list that filters on it was refused ("permission denied
-- for table command_centers"), which broke sign-in. Grant it like the other columns.
grant select (is_demo) on public.command_centers to anon, authenticated;

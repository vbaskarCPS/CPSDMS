-- Payslips for lawn rejuvenation (RUN_58). ADDITIVE ONLY.
-- A payslip run could only be aeration, window cleaning or sealing, so a lawn rejuvenation centre
-- couldn't generate payslips. The run's type now also allows lawn_rejuv. Nothing else changes.
alter table public.payslip_runs drop constraint if exists payslip_runs_season_check;
alter table public.payslip_runs add constraint payslip_runs_season_check check (season in ('aeration', 'cleaning', 'sealing', 'lawn_rejuv'));

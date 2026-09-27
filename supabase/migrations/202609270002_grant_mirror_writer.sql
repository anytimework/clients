-- The Edge Function runs as service_role in the isolated portal project.
-- Migration 004 intentionally revoked every table privilege; restore only the
-- permissions required to maintain the portal's local shift mirror.

begin;

grant select, insert, update, delete
  on table public.client_portal_shifts
  to service_role;

grant usage, select
  on sequence public.client_portal_shifts_id_seq
  to service_role;

grant select, insert, update
  on table public.client_portal_sync_runs
  to service_role;

commit;


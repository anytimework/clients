-- Mirror ShiftOps' per-shift paid marker into the isolated client portal.
-- Run this migration ONLY in project zzqzbqymhlfcexlxtwlr.
-- ShiftOps remains read-only: sync-shiftops only SELECTs from its shifts table.

begin;

alter table public.client_portal_shifts
  add column if not exists is_paid boolean not null default false;

-- Return the payment marker required by the existing portal billing UI.
-- The portal already treats is_paid=true as Paid; no credential, audit, or
-- internal sync fields are exposed by this function.
create or replace function public.get_my_client_shifts(p_legacy_client_id text)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', shift_row.id,
        'shift_date', shift_row.shift_date,
        'outlet', shift_row.outlet,
        'worker_name', shift_row.worker_name,
        'role', shift_row.role,
        'scheduled_start', shift_row.scheduled_start,
        'scheduled_end', shift_row.scheduled_end,
        'clock_in', shift_row.clock_in,
        'clock_out', shift_row.clock_out,
        'cancelled', shift_row.cancelled,
        'rate', shift_row.rate,
        'break_mins', shift_row.break_mins,
        'country', shift_row.country,
        'ot_approved', shift_row.ot_approved,
        'ot_end', shift_row.ot_end,
        'arrived_on_time', shift_row.arrived_on_time,
        'is_paid', shift_row.is_paid
      ) order by shift_row.shift_date desc, shift_row.scheduled_start desc
    ),
    '[]'::jsonb
  )
  from public.client_portal_shifts as shift_row
  where shift_row.client_id = p_legacy_client_id
    and exists (
      select 1
      from public.client_portal_accounts as account
      where account.legacy_client_id = p_legacy_client_id
        and (
          public.is_client_portal_admin()
          or (
            account.access_enabled
            and account.email_status = 'verified'
            and account.auth_user_id = auth.uid()
          )
        )
    );
$$;

revoke all on function public.get_my_client_shifts(text) from public, anon;
grant execute on function public.get_my_client_shifts(text) to authenticated;

commit;

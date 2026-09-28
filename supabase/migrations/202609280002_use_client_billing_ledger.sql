-- Keep client invoicing separate from worker payroll.
-- Run this migration ONLY in project zzqzbqymhlfcexlxtwlr.
-- sync-shiftops derives this field from ShiftOps' read-only
-- app_settings.billing_invoiced_shifts ledger.

begin;

alter table public.client_portal_shifts
  add column if not exists client_billed boolean not null default false;

-- Return a billing status understood by the original portal UI. Deliberately
-- do not return the old is_paid mirror field: that source field represents
-- worker payroll and is unrelated to client invoicing.
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
        'billing_status', case when shift_row.client_billed then 'paid' else 'unpaid' end
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

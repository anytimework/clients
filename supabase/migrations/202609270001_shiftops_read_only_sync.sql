-- Read-only ShiftOps mirror for the isolated client portal.
-- Run this migration ONLY in project zzqzbqymhlfcexlxtwlr.
-- It does not connect to or change Daily Ops.

begin;

alter table public.client_portal_shifts
  add column if not exists rate numeric,
  add column if not exists break_mins integer,
  add column if not exists country text,
  add column if not exists ot_approved boolean,
  add column if not exists ot_end text,
  add column if not exists arrived_on_time boolean,
  add column if not exists source_updated_at timestamptz,
  add column if not exists synced_at timestamptz not null default now(),
  add column if not exists sync_run_id uuid;

-- A normal UNIQUE index is required for PostgREST upserts. PostgreSQL still
-- permits multiple NULL values, so unsourced/manual rows remain possible.
drop index if exists public.client_portal_shifts_source_reference_idx;
create unique index if not exists client_portal_shifts_source_reference_idx
  on public.client_portal_shifts(source_reference);

create index if not exists client_portal_shifts_sync_run_idx
  on public.client_portal_shifts(sync_run_id);

create table if not exists public.client_portal_sync_runs (
  id uuid primary key,
  requested_client_id text references public.client_portal_accounts(legacy_client_id) on delete set null,
  requested_by uuid references auth.users(id) on delete set null,
  status text not null check (status in ('running', 'completed', 'failed')),
  source_rows integer not null default 0,
  mirrored_rows integer not null default 0,
  removed_rows integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.client_portal_sync_runs enable row level security;
alter table public.client_portal_sync_runs force row level security;
revoke all on table public.client_portal_sync_runs from public, anon, authenticated;

create or replace function public.get_client_portal_sync_status()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case
    when not public.is_client_portal_admin() then
      jsonb_build_object('allowed', false)
    else jsonb_build_object(
      'allowed', true,
      'latest', coalesce((
        select jsonb_agg(to_jsonb(run_row) order by started_at desc)
        from (
          select id, requested_client_id, status, source_rows, mirrored_rows,
                 removed_rows, error_message, started_at, completed_at
          from public.client_portal_sync_runs
          order by started_at desc
          limit 20
        ) as run_row
      ), '[]'::jsonb)
    )
  end;
$$;

revoke all on function public.get_client_portal_sync_status() from public, anon;
grant execute on function public.get_client_portal_sync_status() to authenticated;

-- Return only fields required by the client UI. Internal sync identifiers,
-- source references, audit columns, and client IDs are never returned.
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
        'arrived_on_time', shift_row.arrived_on_time
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


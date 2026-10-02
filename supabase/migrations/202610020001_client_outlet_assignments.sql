-- Allow portal administrators to maintain each client's outlet assignment
-- without granting the browser direct write access to the account table.
-- Run this migration ONLY in the isolated client-portal project.

begin;

alter table public.client_portal_accounts
  add column if not exists outlet_links jsonb not null default '{}'::jsonb;

create or replace function public.admin_update_client_portal_profile(
  p_legacy_client_id text,
  p_display_name text,
  p_legacy_contact_email text,
  p_outlets text[],
  p_outlet_links jsonb,
  p_roster_enabled boolean,
  p_pays_by_card boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  cleaned_outlets text[];
  cleaned_links jsonb;
  updated_account public.client_portal_accounts%rowtype;
begin
  if not public.is_client_portal_admin() then
    raise exception 'Portal administrator access required'
      using errcode = '42501';
  end if;

  if nullif(btrim(coalesce(p_legacy_client_id, '')), '') is null then
    raise exception 'Client account is required'
      using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_display_name, '')), '') is null then
    raise exception 'Client name is required'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(outlet_name order by outlet_name), '{}'::text[])
    into cleaned_outlets
  from (
    select distinct btrim(raw_outlet) as outlet_name
    from unnest(coalesce(p_outlets, '{}'::text[])) as raw_outlet
    where nullif(btrim(raw_outlet), '') is not null
  ) as selected_outlets;

  select coalesce(jsonb_object_agg(link.key, link.value), '{}'::jsonb)
    into cleaned_links
  from jsonb_each(coalesce(p_outlet_links, '{}'::jsonb)) as link
  where link.key = any(cleaned_outlets)
    and jsonb_typeof(link.value) = 'number';

  update public.client_portal_accounts
  set display_name = btrim(p_display_name),
      legacy_contact_email = nullif(lower(btrim(coalesce(p_legacy_contact_email, ''))), ''),
      outlets = cleaned_outlets,
      outlet_links = cleaned_links,
      roster_enabled = coalesce(p_roster_enabled, false),
      pays_by_card = coalesce(p_pays_by_card, false),
      updated_at = now()
  where legacy_client_id = p_legacy_client_id
  returning * into updated_account;

  if not found then
    raise exception 'Client account not found'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'legacy_client_id', updated_account.legacy_client_id,
    'display_name', updated_account.display_name,
    'legacy_contact_email', updated_account.legacy_contact_email,
    'outlets', updated_account.outlets,
    'outlet_links', updated_account.outlet_links,
    'roster_enabled', updated_account.roster_enabled,
    'pays_by_card', updated_account.pays_by_card,
    'updated_at', updated_account.updated_at
  );
end;
$$;

revoke all on function public.admin_update_client_portal_profile(
  text, text, text, text[], jsonb, boolean, boolean
) from public, anon;
grant execute on function public.admin_update_client_portal_profile(
  text, text, text, text[], jsonb, boolean, boolean
) to authenticated;

commit;

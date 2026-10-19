-- Migration: audit trail for pricing_params (DRO-980 #55, part 2)
-- Every new version and every activation change is recorded by a trigger, so it covers the admin API
-- and any direct SQL alike. The API writes as service_role, so who clicked is the row's created_by
-- (when the client sent one); db_role shows which database role made the change.

alter table public.pricing_params add column updated_at timestamptz;
update public.pricing_params set updated_at = coalesce(created_at, now());
alter table public.pricing_params alter column updated_at set default now();
alter table public.pricing_params alter column updated_at set not null;

create table public.pricing_params_audit (
  id             bigint generated always as identity primary key,
  changed_at     timestamptz not null default now(),
  action         text not null check (action in ('insert', 'activate', 'deactivate', 'update', 'delete')),
  version        text not null,
  old_is_active  boolean,
  new_is_active  boolean,
  params_changed boolean not null default false,
  created_by     text,
  db_role        text not null
);

create index idx_pricing_params_audit_version on public.pricing_params_audit(version, changed_at);

create or replace function public.pricing_params_touch_updated_at() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  new.updated_at := now();
  return new;
end $$;

create or replace function public.pricing_params_audit_log() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  -- current_user is the owner inside a SECURITY DEFINER function; the role setting still names the
  -- caller's SET ROLE (PostgREST: service_role), and session_user covers a direct SQL session
  caller text := coalesce(nullif(current_setting('role', true), 'none'), session_user);
begin
  -- SECURITY DEFINER: refuse to run as a trigger on any other table, or rows could be forged into the log
  if tg_relid <> 'public.pricing_params'::regclass or tg_when <> 'AFTER' or tg_level <> 'ROW' then
    raise exception 'pricing_params_audit_log() only audits public.pricing_params';
  end if;
  if tg_op = 'INSERT' then
    insert into public.pricing_params_audit (action, version, new_is_active, params_changed, created_by, db_role)
    values ('insert', new.version, new.is_active, true, new.created_by, caller);
  elsif tg_op = 'DELETE' then
    insert into public.pricing_params_audit (action, version, old_is_active, created_by, db_role)
    values ('delete', old.version, old.is_active, old.created_by, caller);
  elsif new.is_active is distinct from old.is_active
        or new.params is distinct from old.params
        or new.version is distinct from old.version then
    insert into public.pricing_params_audit (action, version, old_is_active, new_is_active, params_changed, created_by, db_role)
    values (
      case when new.is_active and not old.is_active then 'activate'
           when old.is_active and not new.is_active then 'deactivate'
           else 'update' end,
      new.version, old.is_active, new.is_active,
      new.params is distinct from old.params, new.created_by, caller
    );
  end if;
  return null;
end $$;

create trigger pricing_params_touch_updated_at
  before update on public.pricing_params
  for each row execute function public.pricing_params_touch_updated_at();

create trigger pricing_params_audit
  after insert or update or delete on public.pricing_params
  for each row execute function public.pricing_params_audit_log();

-- The project's default privileges grant every new table to anon/authenticated: take them back, and keep
-- the log read-only for the service role: only the trigger (running as the owner) writes to it.
alter table public.pricing_params_audit enable row level security;
revoke all on table public.pricing_params_audit from anon, authenticated;
revoke insert, update, delete, truncate on table public.pricing_params_audit from service_role;
-- Default privileges also grant the identity sequence (setval could break every later audit insert)
-- and the functions to every API role, service_role included. Firing a trigger needs neither.
do $$
begin
  execute format('revoke all on sequence %s from public, anon, authenticated, service_role',
                 pg_get_serial_sequence('public.pricing_params_audit', 'id'));
end $$;
revoke execute on function public.pricing_params_audit_log() from public, anon, authenticated, service_role;
revoke execute on function public.pricing_params_touch_updated_at() from public, anon, authenticated, service_role;

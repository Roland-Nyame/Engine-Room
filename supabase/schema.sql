-- The Engine Room: baseline schema and row-level security.
-- Safe to run on the current empty project; keeps existing profile rows if any.

create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'member',
  is_approved boolean not null default false,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_role_check check (role in ('super_admin','admin','member'))
);

alter table public.profiles add column if not exists is_approved boolean not null default false;
alter table public.profiles add column if not exists must_change_password boolean not null default true;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();
alter table public.profiles alter column full_name set default '';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('super_admin','admin','member'));

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('contribution','expense','adjustment')),
  amount_pesewas bigint not null check (amount_pesewas <> 0),
  description text not null check (length(trim(description)) > 0),
  transaction_date date not null default current_date,
  contributor_id uuid references public.profiles(id) on delete set null,
  category text not null default 'General',
  reference text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint transactions_positive_amounts check (
    (type = 'adjustment' and amount_pesewas <> 0) or
    (type in ('contribution','expense') and amount_pesewas > 0)
  )
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  table_name text not null,
  record_id uuid,
  actor_id uuid references public.profiles(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  body text not null check (length(trim(body)) > 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  body text not null check (length(trim(body)) > 0),
  status text not null default 'new' check (status in ('new','reviewing','accepted','declined')),
  admin_response text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.profiles(id) on delete cascade,
  title text not null,
  body text not null,
  created_by uuid references public.profiles(id) on delete set null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists transactions_date_idx on public.transactions (transaction_date desc, created_at desc);
create index if not exists transactions_contributor_idx on public.transactions (contributor_id);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at desc);
create index if not exists suggestions_author_idx on public.suggestions (author_id, created_at desc);
create index if not exists notifications_recipient_idx on public.notifications (recipient_id, created_at desc);

-- Authorization helpers live in a non-exposed schema. They read trusted profile rows,
-- not user-editable auth metadata.
create or replace function private.current_profile_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p
  where p.id = (select auth.uid()) and p.is_approved = true
  limit 1
$$;

create or replace function private.is_approved_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_approved = true
      and p.must_change_password = false
  )
$$;

create or replace function private.has_role(allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_profile_role() = any(allowed_roles), false)
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
revoke all on function private.current_profile_role() from public, anon;
revoke all on function private.is_approved_member() from public, anon;
revoke all on function private.has_role(text[]) from public, anon;
grant execute on function private.current_profile_role() to authenticated;
grant execute on function private.is_approved_member() to authenticated;
grant execute on function private.has_role(text[]) to authenticated;

-- Create a profile for each Auth user. Role and approval are never taken from user metadata.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role, is_approved, must_change_password)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, ''), '@', 1)),
    'member',
    false,
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created_engine_room on auth.users;
create trigger on_auth_user_created_engine_room
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
revoke all on function public.set_updated_at() from public, anon, authenticated;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
drop trigger if exists announcements_set_updated_at on public.announcements;
create trigger announcements_set_updated_at before update on public.announcements
for each row execute function public.set_updated_at();
drop trigger if exists suggestions_set_updated_at on public.suggestions;
create trigger suggestions_set_updated_at before update on public.suggestions
for each row execute function public.set_updated_at();

create or replace function public.log_transaction_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  row_id uuid;
  row_data jsonb;
  action_name text;
  actor uuid;
begin
  if tg_op = 'DELETE' then
    row_id := old.id;
    row_data := to_jsonb(old);
    action_name := 'DELETE';
    actor := (select auth.uid());
  elsif tg_op = 'UPDATE' then
    row_id := new.id;
    row_data := jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new));
    action_name := 'UPDATE';
    actor := (select auth.uid());
  else
    row_id := new.id;
    row_data := to_jsonb(new);
    action_name := 'INSERT';
    actor := (select auth.uid());
  end if;
  insert into public.audit_logs(action, table_name, record_id, actor_id, details)
  values (action_name, 'transactions', row_id, actor, row_data);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$;
revoke all on function public.log_transaction_change() from public, anon, authenticated;
drop trigger if exists transactions_audit_changes on public.transactions;
create trigger transactions_audit_changes after insert or update or delete on public.transactions
for each row execute function public.log_transaction_change();

alter table public.profiles enable row level security;
alter table public.transactions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.announcements enable row level security;
alter table public.suggestions enable row level security;
alter table public.notifications enable row level security;

-- Remove legacy profile policies, including the unsafe self-update policy.
drop policy if exists "Users can read their own profile" on public.profiles;
drop policy if exists "Users can update their own basic profile" on public.profiles;
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists profiles_admin_manage on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or (private.is_approved_member() and is_approved)
  or private.has_role(array['admin','super_admin'])
);
create policy profiles_update_self on public.profiles for update to authenticated
using (id = (select auth.uid()) and private.is_approved_member())
with check (id = (select auth.uid()) and private.is_approved_member());
create policy profiles_admin_manage on public.profiles for all to authenticated
using (private.has_role(array['admin','super_admin']))
with check (private.has_role(array['admin','super_admin']));

-- Restrict self-service profile edits to full_name only; roles/approval/password gates are privileged.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;
grant update (role, is_approved, must_change_password) on public.profiles to authenticated;
-- Column grants above alone are not a security boundary for admin-only fields, so revoke them from normal users
-- and expose privileged changes through server-side admin workflows only.
revoke update (role, is_approved, must_change_password) on public.profiles from authenticated;
grant insert, update, delete on public.profiles to authenticated;
-- RLS still restricts profile writes; the admin-only policy protects admin operations.
-- To avoid self-escalation, a dedicated trigger rejects changes to privileged fields by non-admins.
create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if ((new.role is distinct from old.role
      or new.is_approved is distinct from old.is_approved
      or new.must_change_password is distinct from old.must_change_password)
     and not private.has_role(array['admin','super_admin'])) then
    raise exception 'Only an administrator can change role, approval, or password-reset status';
  end if;
  return new;
end;
$$;
revoke all on function public.protect_profile_privileged_fields() from public, anon, authenticated;
drop trigger if exists profiles_protect_privileged_fields on public.profiles;
create trigger profiles_protect_privileged_fields before update on public.profiles
for each row execute function public.protect_profile_privileged_fields();

drop policy if exists transactions_member_read on public.transactions;
drop policy if exists transactions_admin_write on public.transactions;
create policy transactions_member_read on public.transactions for select to authenticated
using (private.is_approved_member());
create policy transactions_admin_write on public.transactions for all to authenticated
using (private.has_role(array['admin','super_admin']))
with check (private.has_role(array['admin','super_admin']));
grant select, insert, update, delete on public.transactions to authenticated;

drop policy if exists audit_admin_read on public.audit_logs;
create policy audit_admin_read on public.audit_logs for select to authenticated
using (private.has_role(array['admin','super_admin']));
grant select on public.audit_logs to authenticated;

drop policy if exists announcements_member_read on public.announcements;
drop policy if exists announcements_admin_write on public.announcements;
create policy announcements_member_read on public.announcements for select to authenticated
using (private.is_approved_member());
create policy announcements_admin_write on public.announcements for all to authenticated
using (private.has_role(array['admin','super_admin']))
with check (private.has_role(array['admin','super_admin']));
grant select, insert, update, delete on public.announcements to authenticated;

drop policy if exists suggestions_member_insert on public.suggestions;
drop policy if exists suggestions_member_read_own on public.suggestions;
drop policy if exists suggestions_admin_manage on public.suggestions;
create policy suggestions_member_insert on public.suggestions for insert to authenticated
with check (author_id = (select auth.uid()) and private.is_approved_member());
create policy suggestions_member_read_own on public.suggestions for select to authenticated
using (author_id = (select auth.uid()) and private.is_approved_member());
create policy suggestions_admin_manage on public.suggestions for all to authenticated
using (private.has_role(array['admin','super_admin']))
with check (private.has_role(array['admin','super_admin']));
grant select, insert, update on public.suggestions to authenticated;

drop policy if exists notifications_read_own_or_broadcast on public.notifications;
drop policy if exists notifications_admin_manage on public.notifications;
create policy notifications_read_own_or_broadcast on public.notifications for select to authenticated
using (private.is_approved_member() and (recipient_id is null or recipient_id = (select auth.uid())));
create policy notifications_admin_manage on public.notifications for all to authenticated
using (private.has_role(array['admin','super_admin']))
with check (private.has_role(array['admin','super_admin']));
grant select, insert, update, delete on public.notifications to authenticated;

-- Make sure anonymous browser users cannot read or change financial data.
revoke all on public.transactions, public.audit_logs, public.announcements, public.suggestions, public.notifications from anon;

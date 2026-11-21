-- =====================================================================
-- SikaBook — database schema (Supabase / Postgres)
-- Church & organization finance: units (station → societies), members,
-- income, Day Born, expenses with approval + recipient confirmation,
-- budgets, targets, fundraising/pledges and an audit trail.
-- Security: every table has Row Level Security. A user sees only the
-- units their role allows (a society treasurer sees only their society).
-- Nothing financial can be deleted; mistakes are voided with a reason.
-- =====================================================================
create extension if not exists pgcrypto;

-- ---------- Core ----------
create table if not exists public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'church' check (kind in ('church','org')),
  currency text not null default 'GHS',
  features jsonb not null default '{"dayborn":true,"pledges":true}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  parent_id uuid references public.units(id),
  name text not null,
  level text not null,
  is_main boolean not null default false,
  opening_balance numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists units_org_idx on public.units(org_id);
create index if not exists units_parent_idx on public.units(parent_id);

create table if not exists public.org_users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null check (role in ('admin','finsec','treasurer','viewer')),
  unit_id uuid references public.units(id),          -- null = all units
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index if not exists org_users_user_idx on public.org_users(user_id);

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  email text not null,
  display_name text,
  role text not null check (role in ('admin','finsec','treasurer','viewer')),
  unit_id uuid references public.units(id),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------- Access helpers (run as definer so policies can use them) ----------
create or replace function public.my_org_role(o uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from org_users where org_id = o and user_id = auth.uid()
$$;

create or replace function public.my_unit_ids(o uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive ou as (
    select unit_id from org_users where org_id = o and user_id = auth.uid()
  ),
  tree as (
    select u.id from units u
     where u.org_id = o
       and (exists (select 1 from ou where ou.unit_id is null)
            or u.id in (select ou.unit_id from ou where ou.unit_id is not null))
    union
    select c.id from units c join tree t on c.parent_id = t.id
  )
  select id from tree
$$;

create or replace function public.can_see_unit(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from units x where x.id = u and x.id in (select my_unit_ids(x.org_id)))
$$;

create or replace function public.can_write_unit(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from units x
                  where x.id = u
                    and my_org_role(x.org_id) in ('admin','finsec','treasurer')
                    and x.id in (select my_unit_ids(x.org_id)))
$$;

create or replace function public.is_org_member(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select my_org_role(o) is not null
$$;

create or replace function public.is_approver(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_org_role(o) in ('admin','finsec'), false)
$$;

create or replace function public.is_org_admin(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_org_role(o) = 'admin', false)
$$;

-- ---------- Members ----------
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  full_name text not null,
  phone text,
  gender text check (gender in ('M','F')),
  day_born text check (day_born in ('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Unknown')),
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists members_org_idx on public.members(org_id);

create table if not exists public.member_units (
  member_id uuid not null references public.members(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  primary key (member_id, unit_id)
);

-- ---------- Money ----------
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  name text not null,
  target numeric(14,2) not null default 0 check (target >= 0),
  ends_on date,
  created_at timestamptz not null default now()
);

create table if not exists public.pledges (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  member_id uuid not null references public.members(id),
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique (campaign_id, member_id)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  txn_date date not null default current_date,
  category text not null,
  amount numeric(14,2) not null check (amount > 0),
  member_id uuid references public.members(id),
  campaign_id uuid references public.campaigns(id),
  method text,
  note text,
  receipt_no bigint generated always as identity,
  voided boolean not null default false,
  void_reason text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists tx_unit_date_idx on public.transactions(unit_id, txn_date);
create index if not exists tx_member_idx on public.transactions(member_id);

create table if not exists public.dayborn_counts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  sunday date not null,
  amounts numeric(14,2)[] not null check (array_length(amounts,1) = 8),
  counter1 text,
  counter2 text,
  txn_id uuid references public.transactions(id),
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (unit_id, sunday)
);

create table if not exists public.budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  year int not null,
  name text not null,
  amount numeric(14,2) not null check (amount >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  year int not null,
  category text not null,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.payees (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  kind text not null check (kind in ('person','project')),
  name text not null,
  note text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.payee_lines (
  id uuid primary key default gen_random_uuid(),
  payee_id uuid not null references public.payees(id) on delete cascade,
  name text not null,
  frequency text,
  amount numeric(14,2) not null check (amount > 0),
  budget_id uuid references public.budgets(id),
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  unit_id uuid not null references public.units(id),
  exp_date date not null default current_date,
  payee_id uuid references public.payees(id),
  line_id uuid references public.payee_lines(id),
  paid_to text not null,
  purpose text not null,
  amount numeric(14,2) not null check (amount > 0),
  fund text not null default 'General fund',
  budget_id uuid references public.budgets(id),
  note text,
  status text not null default 'pending' check (status in ('pending','approved','confirmed','rejected')),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  confirm_token uuid not null default gen_random_uuid(),
  confirmed_at timestamptz,
  receipt_no bigint generated always as identity,
  voided boolean not null default false,
  void_reason text,
  created_by uuid default auth.uid() references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists exp_unit_date_idx on public.expenses(unit_id, exp_date);
create unique index if not exists exp_token_idx on public.expenses(confirm_token);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid references public.orgs(id) on delete cascade,
  at timestamptz not null default now(),
  user_id uuid,
  user_email text,
  action text,
  entity text,
  summary text
);
create index if not exists audit_org_idx on public.audit_log(org_id, at desc);

-- ---------- Triggers ----------
-- org_id always comes from the unit (clients never choose it)
create or replace function public.set_org_from_unit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.org_id := (select org_id from units where id = new.unit_id);
  if new.org_id is null then raise exception 'Unknown unit'; end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['transactions','dayborn_counts','budgets','targets','campaigns','payees','expenses'] loop
    execute format('drop trigger if exists a_set_org on public.%I', t);
    execute format('create trigger a_set_org before insert on public.%I for each row execute function public.set_org_from_unit()', t);
  end loop;
end $$;

-- Expenses: only approvers approve/reject/void; approved amounts are frozen
create or replace function public.guard_expense() returns trigger
language plpgsql security definer set search_path = public as $$
declare confirming boolean := coalesce(current_setting('sikabook.confirming', true), '') = 'on';
begin
  new.org_id := old.org_id;
  new.confirm_token := old.confirm_token;
  if new.status is distinct from old.status then
    if confirming and old.status = 'approved' and new.status = 'confirmed' then
      new.confirmed_at := now();
    elsif not is_approver(old.org_id) then
      raise exception 'Only the Financial Secretary or an admin can approve expenses';
    elsif old.status = 'pending' and new.status in ('approved','rejected') then
      new.approved_by := auth.uid(); new.approved_at := now();
    elsif new.status = 'confirmed' and old.status = 'approved' then
      new.confirmed_at := now();   -- approver marks as confirmed (e.g. signed paper receipt)
    else
      raise exception 'That status change is not allowed';
    end if;
  end if;
  if new.voided is distinct from old.voided and not is_approver(old.org_id) then
    raise exception 'Only the Financial Secretary or an admin can void an expense';
  end if;
  if old.status <> 'pending' and (new.amount <> old.amount or new.unit_id <> old.unit_id or new.paid_to <> old.paid_to) then
    raise exception 'An approved expense cannot be changed. Void it and record a new one.';
  end if;
  return new;
end $$;
drop trigger if exists b_guard_expense on public.expenses;
create trigger b_guard_expense before update on public.expenses for each row execute function public.guard_expense();

-- Income records: only voiding (by approvers) is allowed after saving
create or replace function public.guard_txn() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_approver(old.org_id) then raise exception 'Only the Financial Secretary or an admin can change saved income'; end if;
  if new.amount <> old.amount or new.unit_id <> old.unit_id or new.category <> old.category or new.txn_date <> old.txn_date then
    raise exception 'Saved income cannot be edited. Void it and record it again.';
  end if;
  new.org_id := old.org_id;
  return new;
end $$;
drop trigger if exists b_guard_txn on public.transactions;
create trigger b_guard_txn before update on public.transactions for each row execute function public.guard_txn();

-- Audit trail
create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(new); oj jsonb; o uuid; s text; who text;
begin
  o := nullif(j->>'org_id','')::uuid;
  if o is null and tg_table_name = 'payee_lines' then select org_id into o from payees where id = (j->>'payee_id')::uuid; end if;
  if o is null and tg_table_name = 'pledges' then select org_id into o from campaigns where id = (j->>'campaign_id')::uuid; end if;
  if tg_table_name = 'orgs' then o := (j->>'id')::uuid; end if;
  s := coalesce(j->>'category', j->>'purpose', j->>'name', j->>'full_name', j->>'email', '');
  if j ? 'paid_to' then s := (j->>'paid_to') || ' — ' || s; end if;
  if tg_table_name = 'dayborn_counts' then s := 'Day Born count for ' || (j->>'sunday'); end if;
  if (j ? 'amount') and (j->>'amount') is not null then s := s || ' · ' || (j->>'amount'); end if;
  if tg_op = 'UPDATE' then
    oj := to_jsonb(old);
    if (j->>'status') is distinct from (oj->>'status') then s := s || ' · now ' || (j->>'status'); end if;
    if (j->>'voided') = 'true' and coalesce(oj->>'voided','false') = 'false' then s := s || ' · VOIDED: ' || coalesce(j->>'void_reason',''); end if;
    if tg_table_name in ('budgets','targets') and (j->>'amount') is distinct from (oj->>'amount') then s := s || ' (was ' || (oj->>'amount') || ')'; end if;
  end if;
  who := coalesce(auth.jwt()->>'email',
                  case when coalesce(current_setting('sikabook.confirming', true),'') = 'on' then 'Recipient (confirmation link)' end,
                  'system');
  insert into audit_log(org_id, user_id, user_email, action, entity, summary)
  values (o, auth.uid(), who, lower(tg_op), tg_table_name, s);
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['orgs','units','members','transactions','dayborn_counts','budgets','targets','campaigns','pledges','payees','payee_lines','expenses','invites'] loop
    execute format('drop trigger if exists z_audit on public.%I', t);
    execute format('create trigger z_audit after insert or update on public.%I for each row execute function public.log_change()', t);
  end loop;
end $$;

-- ---------- Row Level Security ----------
alter table public.orgs enable row level security;
alter table public.units enable row level security;
alter table public.org_users enable row level security;
alter table public.invites enable row level security;
alter table public.members enable row level security;
alter table public.member_units enable row level security;
alter table public.campaigns enable row level security;
alter table public.pledges enable row level security;
alter table public.transactions enable row level security;
alter table public.dayborn_counts enable row level security;
alter table public.budgets enable row level security;
alter table public.targets enable row level security;
alter table public.payees enable row level security;
alter table public.payee_lines enable row level security;
alter table public.expenses enable row level security;
alter table public.audit_log enable row level security;

-- drop old policies so this file can be re-run
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

create policy orgs_sel on public.orgs for select to authenticated using (is_org_member(id));
create policy orgs_upd on public.orgs for update to authenticated using (is_org_admin(id)) with check (is_org_admin(id));

create policy units_sel on public.units for select to authenticated using (can_see_unit(id));
create policy units_ins on public.units for insert to authenticated with check (is_org_admin(org_id));
create policy units_upd on public.units for update to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));

create policy ou_sel on public.org_users for select to authenticated using (is_org_member(org_id));
create policy ou_upd on public.org_users for update to authenticated using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy ou_del on public.org_users for delete to authenticated using (is_org_admin(org_id) and user_id <> auth.uid());

create policy inv_sel on public.invites for select to authenticated using (is_org_admin(org_id));
create policy inv_ins on public.invites for insert to authenticated with check (is_org_admin(org_id));
create policy inv_del on public.invites for delete to authenticated using (is_org_admin(org_id));

create policy mem_sel on public.members for select to authenticated
  using (exists (select 1 from member_units mu where mu.member_id = id and can_see_unit(mu.unit_id)));
create policy mem_upd on public.members for update to authenticated
  using (exists (select 1 from member_units mu where mu.member_id = id and can_write_unit(mu.unit_id)));

create policy mu_sel on public.member_units for select to authenticated using (can_see_unit(unit_id));
create policy mu_ins on public.member_units for insert to authenticated with check (can_write_unit(unit_id));
create policy mu_del on public.member_units for delete to authenticated using (can_write_unit(unit_id));

create policy camp_sel on public.campaigns for select to authenticated using (can_see_unit(unit_id));
create policy camp_ins on public.campaigns for insert to authenticated with check (can_write_unit(unit_id));
create policy camp_upd on public.campaigns for update to authenticated using (can_write_unit(unit_id));

create policy pl_sel on public.pledges for select to authenticated
  using (exists (select 1 from campaigns c where c.id = campaign_id and can_see_unit(c.unit_id)));
create policy pl_ins on public.pledges for insert to authenticated
  with check (exists (select 1 from campaigns c where c.id = campaign_id and can_write_unit(c.unit_id)));
create policy pl_upd on public.pledges for update to authenticated
  using (exists (select 1 from campaigns c where c.id = campaign_id and can_write_unit(c.unit_id)));

create policy tx_sel on public.transactions for select to authenticated using (can_see_unit(unit_id));
create policy tx_ins on public.transactions for insert to authenticated with check (can_write_unit(unit_id) and voided = false);
create policy tx_upd on public.transactions for update to authenticated using (is_approver(org_id));

create policy db_sel on public.dayborn_counts for select to authenticated using (can_see_unit(unit_id));

create policy bud_sel on public.budgets for select to authenticated using (can_see_unit(unit_id));
create policy bud_ins on public.budgets for insert to authenticated with check (can_write_unit(unit_id));
create policy bud_upd on public.budgets for update to authenticated using (can_write_unit(unit_id));

create policy tg_sel on public.targets for select to authenticated using (can_see_unit(unit_id));
create policy tg_ins on public.targets for insert to authenticated with check (can_write_unit(unit_id));
create policy tg_upd on public.targets for update to authenticated using (can_write_unit(unit_id));

create policy py_sel on public.payees for select to authenticated using (can_see_unit(unit_id));
create policy py_ins on public.payees for insert to authenticated with check (can_write_unit(unit_id));
create policy py_upd on public.payees for update to authenticated using (can_write_unit(unit_id));

create policy pyl_sel on public.payee_lines for select to authenticated
  using (exists (select 1 from payees p where p.id = payee_id and can_see_unit(p.unit_id)));
create policy pyl_ins on public.payee_lines for insert to authenticated
  with check (exists (select 1 from payees p where p.id = payee_id and can_write_unit(p.unit_id)));
create policy pyl_upd on public.payee_lines for update to authenticated
  using (exists (select 1 from payees p where p.id = payee_id and can_write_unit(p.unit_id)));

create policy ex_sel on public.expenses for select to authenticated using (can_see_unit(unit_id));
create policy ex_ins on public.expenses for insert to authenticated
  with check (can_write_unit(unit_id) and status = 'pending' and voided = false);
create policy ex_upd on public.expenses for update to authenticated using (can_write_unit(unit_id));

create policy log_sel on public.audit_log for select to authenticated using (is_approver(org_id));

-- ---------- RPCs ----------
create or replace function public.create_org(
  p_name text, p_kind text, p_currency text, p_features jsonb,
  p_main_name text, p_main_level text, p_sub_level text, p_subs text[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare o uuid; m uuid; s text;
begin
  if auth.uid() is null then raise exception 'Please sign in first'; end if;
  insert into orgs(name, kind, currency, features) values (p_name, p_kind, p_currency, coalesce(p_features,'{}'::jsonb)) returning id into o;
  insert into org_users(org_id, user_id, email, role, unit_id) values (o, auth.uid(), auth.jwt()->>'email', 'admin', null);
  insert into units(org_id, name, level, is_main) values (o, p_main_name, p_main_level, true) returning id into m;
  foreach s in array coalesce(p_subs, array[]::text[]) loop
    if length(trim(s)) > 0 then
      insert into units(org_id, parent_id, name, level) values (o, m, trim(s), p_sub_level);
    end if;
  end loop;
  return o;
end $$;

create or replace function public.accept_invites() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; e text := lower(auth.jwt()->>'email');
begin
  if auth.uid() is null or e is null then return 0; end if;
  for r in select * from invites where lower(email) = e and accepted_at is null loop
    insert into org_users(org_id, user_id, email, display_name, role, unit_id)
    values (r.org_id, auth.uid(), e, r.display_name, r.role, r.unit_id)
    on conflict (org_id, user_id) do update set role = excluded.role, unit_id = excluded.unit_id, display_name = excluded.display_name;
    update invites set accepted_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.add_member(
  p_org uuid, p_name text, p_phone text, p_gender text, p_day text, p_units uuid[]
) returns uuid language plpgsql security definer set search_path = public as $$
declare mid uuid; u uuid;
begin
  if p_units is null or array_length(p_units,1) is null then raise exception 'Choose at least one unit'; end if;
  foreach u in array p_units loop
    if not can_write_unit(u) or (select org_id from units where id = u) <> p_org then
      raise exception 'You cannot add members to that unit';
    end if;
  end loop;
  insert into members(org_id, full_name, phone, gender, day_born)
  values (p_org, trim(p_name), nullif(trim(p_phone),''), nullif(p_gender,''), nullif(p_day,'')) returning id into mid;
  foreach u in array p_units loop
    insert into member_units(member_id, unit_id) values (mid, u) on conflict do nothing;
  end loop;
  return mid;
end $$;

create or replace function public.save_dayborn(
  p_unit uuid, p_sunday date, p_amounts numeric[], p_c1 text, p_c2 text
) returns uuid language plpgsql security definer set search_path = public as $$
declare t uuid; total numeric; d uuid;
begin
  if not can_write_unit(p_unit) then raise exception 'You cannot record Day Born for this unit'; end if;
  if array_length(p_amounts,1) <> 8 then raise exception 'Day Born needs 8 group amounts'; end if;
  select coalesce(sum(x),0) into total from unnest(p_amounts) x;
  if total <= 0 then raise exception 'Enter at least one amount'; end if;
  if exists (select 1 from dayborn_counts where unit_id = p_unit and sunday = p_sunday) then
    raise exception 'Day Born for this Sunday is already saved';
  end if;
  insert into transactions(unit_id, txn_date, category, amount, note, method)
  values (p_unit, p_sunday, 'Day Born', total, 'Day Born offering (8 groups)', 'Cash') returning id into t;
  insert into dayborn_counts(unit_id, sunday, amounts, counter1, counter2, txn_id)
  values (p_unit, p_sunday, p_amounts, nullif(p_c1,''), nullif(p_c2,''), t) returning id into d;
  return d;
end $$;

create or replace function public.add_higher_level(p_org uuid, p_name text, p_level text) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not is_org_admin(p_org) then raise exception 'Only an admin can change the structure'; end if;
  insert into units(org_id, name, level) values (p_org, p_name, p_level) returning id into nid;
  update units set parent_id = nid where org_id = p_org and parent_id is null and id <> nid;
  return nid;
end $$;

-- Public (no sign-in) receipt confirmation by the person who was paid
create or replace function public.get_receipt(p_token uuid)
returns table (org_name text, currency text, unit_name text, paid_to text, purpose text, amount numeric, exp_date date, status text)
language sql stable security definer set search_path = public as $$
  select o.name, o.currency, u.name, e.paid_to, e.purpose, e.amount, e.exp_date, e.status
    from expenses e join orgs o on o.id = e.org_id join units u on u.id = e.unit_id
   where e.confirm_token = p_token and e.voided = false
$$;

create or replace function public.confirm_receipt(p_token uuid) returns text
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  select status into st from expenses where confirm_token = p_token and voided = false;
  if st is null then return 'not_found'; end if;
  if st = 'confirmed' then return 'already'; end if;
  if st <> 'approved' then return 'not_ready'; end if;
  perform set_config('sikabook.confirming', 'on', true);
  update expenses set status = 'confirmed' where confirm_token = p_token;
  return 'ok';
end $$;

revoke all on function public.get_receipt(uuid) from public;
revoke all on function public.confirm_receipt(uuid) from public;
grant execute on function public.get_receipt(uuid) to anon, authenticated;
grant execute on function public.confirm_receipt(uuid) to anon, authenticated;

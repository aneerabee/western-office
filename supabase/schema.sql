-- Western Office tables (prefixed wo_ to coexist with BRIX Travel)

create table if not exists wo_customers (
  id bigint primary key,
  payload jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists wo_transfers (
  id bigint primary key,
  payload jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists wo_ledger_entries (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists wo_claim_history (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists wo_daily_closings (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists wo_senders (
  id bigint primary key,
  payload jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists wo_receivers (
  id bigint primary key,
  payload jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- RLS
alter table wo_customers enable row level security;
alter table wo_transfers enable row level security;
alter table wo_ledger_entries enable row level security;
alter table wo_claim_history enable row level security;
alter table wo_daily_closings enable row level security;
alter table wo_senders enable row level security;
alter table wo_receivers enable row level security;

create policy "wo_customers_all" on wo_customers for all using (true) with check (true);
create policy "wo_transfers_all" on wo_transfers for all using (true) with check (true);
create policy "wo_ledger_entries_all" on wo_ledger_entries for all using (true) with check (true);
create policy "wo_claim_history_all" on wo_claim_history for all using (true) with check (true);
create policy "wo_daily_closings_all" on wo_daily_closings for all using (true) with check (true);
create policy "wo_senders_all" on wo_senders for all using (true) with check (true);
create policy "wo_receivers_all" on wo_receivers for all using (true) with check (true);

-- Indexes
create index if not exists idx_wo_transfers_status on wo_transfers ((payload->>'status'));
create index if not exists idx_wo_transfers_customer on wo_transfers ((payload->>'customerId'));
create index if not exists idx_wo_transfers_settled on wo_transfers ((payload->>'settled'));
create index if not exists idx_wo_ledger_customer on wo_ledger_entries ((payload->>'customerId'));
create index if not exists idx_wo_ledger_type on wo_ledger_entries ((payload->>'type'));
create index if not exists idx_wo_daily_closings_date on wo_daily_closings ((payload->>'date'));

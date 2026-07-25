create table if not exists operator_settings (
  id text primary key,
  product jsonb not null,
  updated_at timestamptz not null default now()
);

alter table operator_settings enable row level security;

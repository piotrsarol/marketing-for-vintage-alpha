create table if not exists marketplace_snapshots (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  country text not null,
  observed_at timestamptz not null default now(),
  listing_ids text[] not null default '{}',
  listing_count integer not null default 0,
  median_price numeric(12,2) not null default 0,
  currency text not null default 'PLN',
  average_favourites numeric(12,2) not null default 0,
  top_favourites integer not null default 0
);

create index if not exists marketplace_snapshots_lookup_idx
  on marketplace_snapshots(query, country, observed_at desc);

alter table trends add column if not exists marketplace jsonb;

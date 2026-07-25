create extension if not exists "pgcrypto";

create table if not exists trends (
  id uuid primary key default gen_random_uuid(),
  topic text not null,
  category text not null,
  confidence numeric(5,2) not null default 0,
  source text not null,
  url text,
  discovery_query text,
  country text not null default 'PL',
  season text,
  keywords text[] not null default '{}',
  virality numeric(5,2),
  commercial_intent numeric(5,2),
  novelty numeric(5,2),
  evergreen_score numeric(5,2),
  vinted_relevance numeric(5,2),
  predicted_engagement numeric(5,2),
  reasoning text,
  content_angles jsonb not null default '[]',
  hooks jsonb not null default '[]',
  target_audience jsonb not null default '[]',
  status text not null default 'discovered' check (status in ('discovered','approved','rejected','review')),
  discovered_at timestamptz not null default now()
);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  trend_id uuid references trends(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft','approved','scheduled','published','failed')),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists publishing_queue (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references campaigns(id) on delete cascade,
  platform text not null,
  scheduled_for timestamptz not null,
  status text not null default 'queued' check (status in ('queued','published','failed')),
  attempts integer not null default 0,
  external_id text,
  last_error text
);

create table if not exists waitlist_leads (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  source text,
  landing_variant text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  referrer text,
  created_at timestamptz not null default now()
);

create table if not exists funnel_events (
  id uuid primary key default gen_random_uuid(),
  event text not null check (event in ('page_view', 'waitlist_signup')),
  session_id text,
  path text,
  source text not null default 'direct',
  landing_variant text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  referrer text,
  created_at timestamptz not null default now()
);

create table if not exists job_runs (
  id uuid primary key default gen_random_uuid(),
  workflow text not null,
  status text not null,
  input jsonb not null default '{}',
  output jsonb not null default '{}',
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create table if not exists operator_settings (
  id text primary key,
  product jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists trends_status_idx on trends(status);
create index if not exists publishing_queue_schedule_idx on publishing_queue(scheduled_for, status);
create index if not exists waitlist_created_idx on waitlist_leads(created_at);
create index if not exists funnel_events_created_idx on funnel_events(created_at);
create index if not exists funnel_events_campaign_idx on funnel_events(utm_campaign, event);

alter table trends enable row level security;
alter table campaigns enable row level security;
alter table publishing_queue enable row level security;
alter table waitlist_leads enable row level security;
alter table funnel_events enable row level security;
alter table job_runs enable row level security;
alter table operator_settings enable row level security;

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

alter table waitlist_leads add column if not exists utm_source text;
alter table waitlist_leads add column if not exists utm_medium text;
alter table waitlist_leads add column if not exists utm_campaign text;
alter table waitlist_leads add column if not exists utm_content text;
alter table waitlist_leads add column if not exists referrer text;

create index if not exists funnel_events_created_idx on funnel_events(created_at);
create index if not exists funnel_events_campaign_idx on funnel_events(utm_campaign, event);
alter table funnel_events enable row level security;

begin;

with duplicate_trends as (
  select
    id,
    row_number() over (
      partition by regexp_replace(lower(trim(topic)), '[^[:alnum:]]+', '', 'g')
      order by confidence desc nulls last, discovered_at asc, id
    ) as duplicate_rank
  from public.trends
  where topic ilike 'Fashion Brands Are Missing Out on the Resale Opportunity'
)
delete from public.trends
where id in (
  select id from duplicate_trends where duplicate_rank > 1
);

with duplicate_campaigns as (
  select
    id,
    row_number() over (
      partition by regexp_replace(lower(trim(payload #>> '{trend,topic}')), '[^[:alnum:]]+', '', 'g')
      order by created_at asc, id
    ) as duplicate_rank
  from public.campaigns
  where payload #>> '{trend,topic}' ilike 'Fashion Brands Are Missing Out on the Resale Opportunity'
)
delete from public.campaigns
where id in (
  select id from duplicate_campaigns where duplicate_rank > 1
);

commit;

alter table publishing_queue
  drop constraint if exists publishing_queue_status_check;

alter table publishing_queue
  add constraint publishing_queue_status_check
  check (status in ('queued', 'published', 'failed', 'cancelled'));

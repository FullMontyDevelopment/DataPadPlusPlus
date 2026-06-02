delete from order_metrics
where time >= '2026-01-01 00:03:00+00'::timestamptz
  and time <= '2026-03-11 10:40:00+00'::timestamptz;

insert into order_metrics (time, account_id, region, orders, latency_ms)
select
  '2026-01-01 00:00:00+00'::timestamptz + (generated.id * interval '1 minute'),
  (generated.id % 500) + 1,
  case generated.id % 5
    when 0 then 'eu-west-1'
    when 1 then 'us-east-1'
    when 2 then 'ap-southeast-1'
    when 3 then 'af-south-1'
    else 'local'
  end,
  (generated.id % 40) + 1,
  ((generated.id % 1000)::double precision / 7.0) + 12.5
from generate_series(3, 100000) as generated(id);

create table if not exists system_metrics (
  time timestamptz not null,
  host text not null,
  service text not null,
  cpu_pct double precision not null,
  memory_mb double precision not null,
  requests integer not null
);

select create_hypertable('system_metrics', 'time', if_not_exists => true);

delete from system_metrics
where time >= '2026-01-01 00:00:30+00'::timestamptz
  and time <= '2026-02-04 17:20:00+00'::timestamptz;

insert into system_metrics (time, host, service, cpu_pct, memory_mb, requests)
select
  '2026-01-01 00:00:00+00'::timestamptz + (generated.id * interval '30 seconds'),
  'fixture-host-' || (generated.id % 20),
  case generated.id % 5 when 0 then 'api' when 1 then 'worker' when 2 then 'search' when 3 then 'billing' else 'scheduler' end,
  ((generated.id % 900)::double precision / 10.0) + 5.0,
  ((generated.id % 8000)::double precision / 3.0) + 256.0,
  (generated.id % 5000) + 50
from generate_series(1, 100000) as generated(id);

create index if not exists system_metrics_service_time_idx on system_metrics (service, time desc);

create or replace view system_metrics_recent as
select service, avg(cpu_pct) as avg_cpu_pct, avg(memory_mb) as avg_memory_mb, sum(requests) as requests
from system_metrics
where time >= '2026-01-01 00:00:00+00'
group by service;

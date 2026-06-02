insert into analytics.events
select
  toDate('2026-01-01') + toIntervalDay(number % 30),
  toDateTime('2026-01-01 00:00:00') + toIntervalSecond(number),
  (number % 500) + 1,
  multiIf(number % 5 = 0, 'order.created', number % 5 = 1, 'order.paid', number % 5 = 2, 'inventory.adjusted', number % 5 = 3, 'session.heartbeat', 'support.ticket'),
  ((number % 1000) / 7.0) + 8.5
from numbers(250000);

create table if not exists analytics.order_items (
  event_date Date,
  order_id UInt32,
  line_number UInt8,
  account_id UInt32,
  sku String,
  quantity UInt16,
  unit_price Float64,
  region LowCardinality(String)
) engine = MergeTree
order by (event_date, account_id, order_id, line_number);

truncate table analytics.order_items;

insert into analytics.order_items
select
  toDate('2026-01-01') + toIntervalDay(number % 30),
  1000 + number,
  (number % 3) + 1,
  (number % 500) + 1,
  concat('sku-', substring(concat('0000', toString((number % 1000) + 1)), -4)),
  (number % 4) + 1,
  ((number % 500) / 2.5) + 12,
  multiIf(number % 5 = 0, 'eu-west-1', number % 5 = 1, 'us-east-1', number % 5 = 2, 'ap-southeast-1', number % 5 = 3, 'af-south-1', 'local')
from numbers(75000);

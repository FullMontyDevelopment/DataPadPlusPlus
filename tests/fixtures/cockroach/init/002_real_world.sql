use datapadplusplus;

create table if not exists order_items (
  order_id int not null,
  line_number int not null,
  sku string not null,
  quantity int not null,
  unit_price decimal not null,
  discount decimal not null default 0,
  primary key (order_id, line_number)
);

create table if not exists support_tickets (
  ticket_id int primary key,
  account_id int not null,
  priority string not null,
  status string not null,
  channel string not null,
  subject string not null,
  created_at timestamptz not null,
  resolved_at timestamptz,
  index support_tickets_account_status_idx (account_id, status)
);

upsert into accounts (id, name, status, updated_at)
select
  id,
  'Fixture Account ' || id,
  case id % 6 when 0 then 'paused' when 1 then 'trial' else 'active' end,
  now() - ((id % 1440)::int * interval '1 minute')
from generate_series(4, 500) as generated(id);

upsert into products (sku, name, category, inventory_available, price, updated_at)
select
  'sku-' || lpad(id::string, 4, '0'),
  'Fixture Product ' || id,
  case id % 6 when 0 then 'lighting' when 1 then 'furniture' when 2 then 'storage' when 3 then 'audio' when 4 then 'office' else 'accessories' end,
  (id * 17) % 250,
  ((id % 500)::decimal / 2.5) + 12,
  now() - ((id % 720)::int * interval '1 minute')
from generate_series(1, 1000) as generated(id);

upsert into orders (order_id, account_id, status, total_amount, updated_at)
select
  1000 + id,
  (id % 500) + 1,
  case id % 7 when 0 then 'created' when 1 then 'processing' when 2 then 'paid' when 3 then 'fulfilled' when 4 then 'returned' when 5 then 'cancelled' else 'on-hold' end,
  ((id % 20000)::decimal / 4.0) + 25,
  now() - ((id % 259200)::int * interval '1 second')
from generate_series(1, 25000) as generated(id);

upsert into order_items (order_id, line_number, sku, quantity, unit_price, discount)
select
  1000 + order_id,
  line_number,
  'sku-' || lpad(((order_id + line_number) % 1000 + 1)::string, 4, '0'),
  ((order_id + line_number) % 4) + 1,
  (((order_id + line_number) % 500)::decimal / 2.5) + 12,
  case (order_id + line_number) % 10 when 0 then 10.00 else 0.00 end
from generate_series(1, 25000) as orders(order_id)
cross join generate_series(1, 3) as lines(line_number);

upsert into support_tickets (ticket_id, account_id, priority, status, channel, subject, created_at, resolved_at)
select
  id,
  (id % 500) + 1,
  case id % 4 when 0 then 'critical' when 1 then 'high' when 2 then 'normal' else 'low' end,
  case id % 5 when 0 then 'open' when 1 then 'assigned' when 2 then 'waiting-on-customer' else 'resolved' end,
  case id % 4 when 0 then 'email' when 1 then 'chat' when 2 then 'phone' else 'portal' end,
  'Fixture support ticket ' || id,
  now() - ((id % 1209600)::int * interval '1 second'),
  case when id % 5 in (3, 4) then now() - ((id % 604800)::int * interval '1 second') else null end
from generate_series(1, 5000) as generated(id);

alter table orders
  add constraint if not exists fk_orders_accounts foreign key (account_id) references accounts(id);

alter table order_items
  add constraint if not exists fk_order_items_orders foreign key (order_id) references orders(order_id);

alter table order_items
  add constraint if not exists fk_order_items_products foreign key (sku) references products(sku);

alter table support_tickets
  add constraint if not exists fk_support_tickets_accounts foreign key (account_id) references accounts(id);

create index if not exists order_items_sku_idx on order_items (sku);

create or replace view order_fulfillment_summary as
select
  orders.account_id,
  accounts.name as account_name,
  orders.status,
  count(*) as order_count,
  sum(orders.total_amount) as total_amount
from orders
join accounts on accounts.id = orders.account_id
group by orders.account_id, accounts.name, orders.status;

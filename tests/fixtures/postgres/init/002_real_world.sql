create table if not exists public.order_items (
  order_id integer not null references public.orders(order_id),
  line_number integer not null,
  sku text not null references public.products(sku),
  quantity integer not null,
  unit_price numeric(12, 2) not null,
  discount numeric(5, 2) not null default 0,
  primary key (order_id, line_number)
);

create table if not exists public.inventory_movements (
  movement_id bigint primary key,
  sku text not null references public.products(sku),
  warehouse text not null,
  movement_type text not null,
  quantity integer not null,
  reason text not null,
  created_at timestamptz not null
);

create table if not exists public.support_tickets (
  ticket_id bigint primary key,
  account_id integer not null references public.accounts(id),
  priority text not null,
  status text not null,
  channel text not null,
  subject text not null,
  created_at timestamptz not null,
  resolved_at timestamptz
);

create table if not exists observability.audit_log (
  audit_id bigint primary key,
  actor text not null,
  action text not null,
  object_type text not null,
  object_id text not null,
  metadata jsonb not null,
  created_at timestamptz not null
);

insert into public.accounts (id, name, status, tier, updated_at)
select
  id,
  'Fixture Account ' || id,
  case id % 6 when 0 then 'paused' when 1 then 'trial' else 'active' end,
  case id % 4 when 0 then 'enterprise' when 1 then 'growth' when 2 then 'starter' else 'scale' end,
  now() - ((id % 1440) * interval '1 minute')
from generate_series(4, 500) as generated(id)
on conflict (id) do update
set name = excluded.name, status = excluded.status, tier = excluded.tier, updated_at = excluded.updated_at;

insert into public.products (sku, name, category, inventory_available, price, updated_at)
select
  'sku-' || lpad(id::text, 4, '0'),
  'Fixture Product ' || id,
  case id % 6
    when 0 then 'lighting'
    when 1 then 'furniture'
    when 2 then 'storage'
    when 3 then 'audio'
    when 4 then 'office'
    else 'accessories'
  end,
  (id * 17) % 250,
  round(((id % 500)::numeric / 2.5) + 12, 2),
  now() - ((id % 720) * interval '1 minute')
from generate_series(1, 1000) as generated(id)
on conflict (sku) do update
set
  name = excluded.name,
  category = excluded.category,
  inventory_available = excluded.inventory_available,
  price = excluded.price,
  updated_at = excluded.updated_at;

insert into public.orders (order_id, account_id, status, total_amount, updated_at)
select
  1000 + id,
  (id % 500) + 1,
  case id % 7
    when 0 then 'created'
    when 1 then 'processing'
    when 2 then 'paid'
    when 3 then 'fulfilled'
    when 4 then 'returned'
    when 5 then 'cancelled'
    else 'on-hold'
  end,
  round(((id % 20000)::numeric / 4.0) + 25, 2),
  now() - ((id % 259200) * interval '1 second')
from generate_series(1, 25000) as generated(id)
on conflict (order_id) do update
set
  account_id = excluded.account_id,
  status = excluded.status,
  total_amount = excluded.total_amount,
  updated_at = excluded.updated_at;

insert into public.order_items (order_id, line_number, sku, quantity, unit_price, discount)
select
  1000 + order_id,
  line_number,
  'sku-' || lpad(((order_id + line_number) % 1000 + 1)::text, 4, '0'),
  (order_id + line_number) % 4 + 1,
  round((((order_id + line_number) % 500)::numeric / 2.5) + 12, 2),
  case (order_id + line_number) % 10 when 0 then 10.00 else 0.00 end
from generate_series(1, 25000) as orders(order_id)
cross join generate_series(1, 3) as lines(line_number)
on conflict (order_id, line_number) do update
set sku = excluded.sku, quantity = excluded.quantity, unit_price = excluded.unit_price, discount = excluded.discount;

insert into public.inventory_movements (movement_id, sku, warehouse, movement_type, quantity, reason, created_at)
select
  id,
  'sku-' || lpad((id % 1000 + 1)::text, 4, '0'),
  case id % 5 when 0 then 'eu-west-1' when 1 then 'us-east-1' when 2 then 'ap-southeast-1' when 3 then 'af-south-1' else 'local' end,
  case id % 4 when 0 then 'received' when 1 then 'reserved' when 2 then 'released' else 'shipped' end,
  (id % 50) + 1,
  case id % 3 when 0 then 'customer-order' when 1 then 'cycle-count' else 'supplier-receipt' end,
  now() - ((id % 604800) * interval '1 second')
from generate_series(1, 50000) as generated(id)
on conflict (movement_id) do update
set sku = excluded.sku, warehouse = excluded.warehouse, movement_type = excluded.movement_type, quantity = excluded.quantity, reason = excluded.reason, created_at = excluded.created_at;

insert into public.support_tickets (ticket_id, account_id, priority, status, channel, subject, created_at, resolved_at)
select
  id,
  (id % 500) + 1,
  case id % 4 when 0 then 'critical' when 1 then 'high' when 2 then 'normal' else 'low' end,
  case id % 5 when 0 then 'open' when 1 then 'assigned' when 2 then 'waiting-on-customer' else 'resolved' end,
  case id % 4 when 0 then 'email' when 1 then 'chat' when 2 then 'phone' else 'portal' end,
  'Fixture support ticket ' || id,
  now() - ((id % 1209600) * interval '1 second'),
  case when id % 5 in (3, 4) then now() - ((id % 604800) * interval '1 second') else null end
from generate_series(1, 5000) as generated(id)
on conflict (ticket_id) do update
set account_id = excluded.account_id, priority = excluded.priority, status = excluded.status, channel = excluded.channel, subject = excluded.subject, created_at = excluded.created_at, resolved_at = excluded.resolved_at;

insert into observability.audit_log (audit_id, actor, action, object_type, object_id, metadata, created_at)
select
  id,
  'user-' || (id % 250),
  case id % 5 when 0 then 'create' when 1 then 'update' when 2 then 'approve' when 3 then 'export' else 'archive' end,
  case id % 4 when 0 then 'order' when 1 then 'product' when 2 then 'account' else 'ticket' end,
  (id % 25000)::text,
  jsonb_build_object('region', case id % 5 when 0 then 'eu-west-1' when 1 then 'us-east-1' when 2 then 'ap-southeast-1' when 3 then 'af-south-1' else 'local' end, 'fixture', true),
  now() - ((id % 604800) * interval '1 second')
from generate_series(1, 100000) as generated(id)
on conflict (audit_id) do update
set actor = excluded.actor, action = excluded.action, object_type = excluded.object_type, object_id = excluded.object_id, metadata = excluded.metadata, created_at = excluded.created_at;

create index if not exists order_items_sku_idx on public.order_items (sku);
create index if not exists inventory_movements_sku_created_idx on public.inventory_movements (sku, created_at desc);
create index if not exists support_tickets_account_status_idx on public.support_tickets (account_id, status);
create index if not exists audit_log_object_created_idx on observability.audit_log (object_type, created_at desc);

create or replace view public.order_fulfillment_summary as
select
  orders.account_id,
  accounts.name as account_name,
  orders.status,
  count(*) as order_count,
  sum(orders.total_amount) as total_amount
from public.orders
join public.accounts on accounts.id = orders.account_id
group by orders.account_id, accounts.name, orders.status;

create or replace view observability.recent_audit_activity as
select actor, action, object_type, count(*) as event_count, max(created_at) as last_seen_at
from observability.audit_log
group by actor, action, object_type;

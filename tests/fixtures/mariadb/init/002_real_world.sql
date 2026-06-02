create table if not exists order_items (
  order_id bigint not null,
  line_number int not null,
  sku varchar(64) not null,
  quantity int not null,
  unit_price decimal(12,2) not null,
  discount decimal(5,2) not null default 0,
  primary key (order_id, line_number),
  index order_items_sku_idx (sku)
);

create table if not exists support_tickets (
  ticket_id bigint primary key,
  account_id bigint not null,
  priority varchar(32) not null,
  status varchar(32) not null,
  channel varchar(32) not null,
  subject varchar(255) not null,
  created_at timestamp not null,
  resolved_at timestamp null,
  index support_tickets_account_status_idx (account_id, status)
);

set max_recursive_iterations = 250000;

insert into accounts (id, name, status, updated_at)
with recursive sequence_numbers(id) as (
  select 4
  union all
  select id + 1 from sequence_numbers where id < 500
)
select
  id,
  concat('Fixture Account ', id),
  case id % 6 when 0 then 'paused' when 1 then 'trial' else 'active' end,
  timestampadd(minute, -(id % 1440), now())
from sequence_numbers
on duplicate key update name = values(name), status = values(status), updated_at = values(updated_at);

insert into products (sku, name, category, inventory_available, price, updated_at)
with recursive sequence_numbers(id) as (
  select 1
  union all
  select id + 1 from sequence_numbers where id < 1000
)
select
  concat('sku-', lpad(id, 4, '0')),
  concat('Fixture Product ', id),
  case id % 6 when 0 then 'lighting' when 1 then 'furniture' when 2 then 'storage' when 3 then 'audio' when 4 then 'office' else 'accessories' end,
  (id * 17) % 250,
  ((id % 500) / 2.5) + 12,
  timestampadd(minute, -(id % 720), now())
from sequence_numbers
on duplicate key update name = values(name), category = values(category), inventory_available = values(inventory_available), price = values(price), updated_at = values(updated_at);

insert into orders (order_id, account_id, status, total_amount, updated_at)
with recursive sequence_numbers(id) as (
  select 1
  union all
  select id + 1 from sequence_numbers where id < 25000
)
select
  1000 + id,
  (id % 500) + 1,
  case id % 7 when 0 then 'created' when 1 then 'processing' when 2 then 'paid' when 3 then 'fulfilled' when 4 then 'returned' when 5 then 'cancelled' else 'on-hold' end,
  ((id % 20000) / 4.0) + 25,
  timestampadd(second, -(id % 259200), now())
from sequence_numbers
on duplicate key update account_id = values(account_id), status = values(status), total_amount = values(total_amount), updated_at = values(updated_at);

insert into order_items (order_id, line_number, sku, quantity, unit_price, discount)
with recursive sequence_numbers(id) as (
  select 1
  union all
  select id + 1 from sequence_numbers where id < 25000
)
select
  1000 + id,
  line_number,
  concat('sku-', lpad(((id + line_number) % 1000) + 1, 4, '0')),
  ((id + line_number) % 4) + 1,
  (((id + line_number) % 500) / 2.5) + 12,
  case (id + line_number) % 10 when 0 then 10.00 else 0.00 end
from sequence_numbers
join (
  select 1 as line_number union all select 2 union all select 3
) lines
on duplicate key update sku = values(sku), quantity = values(quantity), unit_price = values(unit_price), discount = values(discount);

insert into support_tickets (ticket_id, account_id, priority, status, channel, subject, created_at, resolved_at)
with recursive sequence_numbers(id) as (
  select 1
  union all
  select id + 1 from sequence_numbers where id < 5000
)
select
  id,
  (id % 500) + 1,
  case id % 4 when 0 then 'critical' when 1 then 'high' when 2 then 'normal' else 'low' end,
  case id % 5 when 0 then 'open' when 1 then 'assigned' when 2 then 'waiting-on-customer' else 'resolved' end,
  case id % 4 when 0 then 'email' when 1 then 'chat' when 2 then 'phone' else 'portal' end,
  concat('Fixture support ticket ', id),
  timestampadd(second, -(id % 1209600), now()),
  case when id % 5 in (3, 4) then timestampadd(second, -(id % 604800), now()) else null end
from sequence_numbers
on duplicate key update account_id = values(account_id), priority = values(priority), status = values(status), channel = values(channel), subject = values(subject), created_at = values(created_at), resolved_at = values(resolved_at);

set @constraint_exists = (
  select count(*)
  from information_schema.table_constraints
  where table_schema = database()
    and constraint_name = 'fk_orders_accounts'
);
set @constraint_sql = if(@constraint_exists = 0, 'alter table orders add constraint fk_orders_accounts foreign key (account_id) references accounts(id)', 'select 1');
prepare constraint_statement from @constraint_sql;
execute constraint_statement;
deallocate prepare constraint_statement;

set @constraint_exists = (
  select count(*)
  from information_schema.table_constraints
  where table_schema = database()
    and constraint_name = 'fk_order_items_orders'
);
set @constraint_sql = if(@constraint_exists = 0, 'alter table order_items add constraint fk_order_items_orders foreign key (order_id) references orders(order_id)', 'select 1');
prepare constraint_statement from @constraint_sql;
execute constraint_statement;
deallocate prepare constraint_statement;

set @constraint_exists = (
  select count(*)
  from information_schema.table_constraints
  where table_schema = database()
    and constraint_name = 'fk_order_items_products'
);
set @constraint_sql = if(@constraint_exists = 0, 'alter table order_items add constraint fk_order_items_products foreign key (sku) references products(sku)', 'select 1');
prepare constraint_statement from @constraint_sql;
execute constraint_statement;
deallocate prepare constraint_statement;

set @constraint_exists = (
  select count(*)
  from information_schema.table_constraints
  where table_schema = database()
    and constraint_name = 'fk_support_tickets_accounts'
);
set @constraint_sql = if(@constraint_exists = 0, 'alter table support_tickets add constraint fk_support_tickets_accounts foreign key (account_id) references accounts(id)', 'select 1');
prepare constraint_statement from @constraint_sql;
execute constraint_statement;
deallocate prepare constraint_statement;

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

use datapadplusplus;
go

if object_id('dbo.order_items', 'U') is null
begin
  create table dbo.order_items (
    order_id int not null,
    line_number int not null,
    sku nvarchar(64) not null,
    quantity int not null,
    unit_price decimal(12, 2) not null,
    discount decimal(5, 2) not null default 0,
    constraint pk_order_items primary key (order_id, line_number)
  );
  create index ix_order_items_sku on dbo.order_items (sku);
end
go

if object_id('dbo.support_tickets', 'U') is null
begin
  create table dbo.support_tickets (
    ticket_id bigint primary key,
    account_id int not null,
    priority nvarchar(32) not null,
    status nvarchar(32) not null,
    channel nvarchar(32) not null,
    subject nvarchar(255) not null,
    created_at datetime2 not null,
    resolved_at datetime2 null
  );
  create index ix_support_tickets_account_status on dbo.support_tickets (account_id, status);
end
go

merge dbo.accounts as target
using (
  select top (497)
    row_number() over (order by first_source.object_id) + 3 as id
  from sys.all_objects first_source
) as generated
on target.id = generated.id
when matched then
  update set
    name = concat('Fixture Account ', generated.id),
    status = case generated.id % 6 when 0 then 'paused' when 1 then 'trial' else 'active' end,
    tier = case generated.id % 4 when 0 then 'enterprise' when 1 then 'growth' when 2 then 'starter' else 'scale' end,
    updated_at = dateadd(minute, -(generated.id % 1440), sysutcdatetime())
when not matched then
  insert (id, name, status, tier, updated_at)
  values (
    generated.id,
    concat('Fixture Account ', generated.id),
    case generated.id % 6 when 0 then 'paused' when 1 then 'trial' else 'active' end,
    case generated.id % 4 when 0 then 'enterprise' when 1 then 'growth' when 2 then 'starter' else 'scale' end,
    dateadd(minute, -(generated.id % 1440), sysutcdatetime())
  );
go

merge dbo.products as target
using (
  select top (1000)
    row_number() over (order by first_source.object_id, second_source.object_id) as id
  from sys.all_objects first_source
  cross join sys.all_objects second_source
) as generated
on target.sku = concat('sku-', right(concat('0000', generated.id), 4))
when matched then
  update set
    name = concat('Fixture Product ', generated.id),
    category = case generated.id % 6 when 0 then 'lighting' when 1 then 'furniture' when 2 then 'storage' when 3 then 'audio' when 4 then 'office' else 'accessories' end,
    inventory_available = (generated.id * 17) % 250,
    price = cast(((generated.id % 500) / 2.5) + 12 as decimal(12, 2)),
    updated_at = dateadd(minute, -(generated.id % 720), sysutcdatetime())
when not matched then
  insert (sku, name, category, inventory_available, price, updated_at)
  values (
    concat('sku-', right(concat('0000', generated.id), 4)),
    concat('Fixture Product ', generated.id),
    case generated.id % 6 when 0 then 'lighting' when 1 then 'furniture' when 2 then 'storage' when 3 then 'audio' when 4 then 'office' else 'accessories' end,
    (generated.id * 17) % 250,
    cast(((generated.id % 500) / 2.5) + 12 as decimal(12, 2)),
    dateadd(minute, -(generated.id % 720), sysutcdatetime())
  );
go

merge dbo.orders as target
using (
  select top (25000)
    row_number() over (order by first_source.object_id, second_source.object_id) as id
  from sys.all_objects first_source
  cross join sys.all_objects second_source
) as generated
on target.order_id = 1000 + generated.id
when matched then
  update set
    account_id = (generated.id % 500) + 1,
    status = case generated.id % 7 when 0 then 'created' when 1 then 'processing' when 2 then 'paid' when 3 then 'fulfilled' when 4 then 'returned' when 5 then 'cancelled' else 'on-hold' end,
    total_amount = cast(((generated.id % 20000) / 4.0) + 25 as decimal(12, 2)),
    updated_at = dateadd(second, -(generated.id % 259200), sysutcdatetime())
when not matched then
  insert (order_id, account_id, status, total_amount, updated_at)
  values (
    1000 + generated.id,
    (generated.id % 500) + 1,
    case generated.id % 7 when 0 then 'created' when 1 then 'processing' when 2 then 'paid' when 3 then 'fulfilled' when 4 then 'returned' when 5 then 'cancelled' else 'on-hold' end,
    cast(((generated.id % 20000) / 4.0) + 25 as decimal(12, 2)),
    dateadd(second, -(generated.id % 259200), sysutcdatetime())
  );
go

merge dbo.order_items as target
using (
  select
    1000 + generated.id as order_id,
    lines.line_number,
    concat('sku-', right(concat('0000', ((generated.id + lines.line_number) % 1000) + 1), 4)) as sku,
    ((generated.id + lines.line_number) % 4) + 1 as quantity,
    cast((((generated.id + lines.line_number) % 500) / 2.5) + 12 as decimal(12, 2)) as unit_price,
    cast(case (generated.id + lines.line_number) % 10 when 0 then 10.00 else 0.00 end as decimal(5, 2)) as discount
  from (
    select top (25000)
      row_number() over (order by first_source.object_id, second_source.object_id) as id
    from sys.all_objects first_source
    cross join sys.all_objects second_source
  ) generated
  cross join (values (1), (2), (3)) as lines(line_number)
) as source
on target.order_id = source.order_id and target.line_number = source.line_number
when matched then update set sku = source.sku, quantity = source.quantity, unit_price = source.unit_price, discount = source.discount
when not matched then insert (order_id, line_number, sku, quantity, unit_price, discount) values (source.order_id, source.line_number, source.sku, source.quantity, source.unit_price, source.discount);
go

merge dbo.support_tickets as target
using (
  select top (5000)
    row_number() over (order by first_source.object_id, second_source.object_id) as id
  from sys.all_objects first_source
  cross join sys.all_objects second_source
) as generated
on target.ticket_id = generated.id
when matched then
  update set
    account_id = (generated.id % 500) + 1,
    priority = case generated.id % 4 when 0 then 'critical' when 1 then 'high' when 2 then 'normal' else 'low' end,
    status = case generated.id % 5 when 0 then 'open' when 1 then 'assigned' when 2 then 'waiting-on-customer' else 'resolved' end,
    channel = case generated.id % 4 when 0 then 'email' when 1 then 'chat' when 2 then 'phone' else 'portal' end,
    subject = concat('Fixture support ticket ', generated.id),
    created_at = dateadd(second, -(generated.id % 1209600), sysutcdatetime()),
    resolved_at = case when generated.id % 5 in (3, 4) then dateadd(second, -(generated.id % 604800), sysutcdatetime()) else null end
when not matched then
  insert (ticket_id, account_id, priority, status, channel, subject, created_at, resolved_at)
  values (
    generated.id,
    (generated.id % 500) + 1,
    case generated.id % 4 when 0 then 'critical' when 1 then 'high' when 2 then 'normal' else 'low' end,
    case generated.id % 5 when 0 then 'open' when 1 then 'assigned' when 2 then 'waiting-on-customer' else 'resolved' end,
    case generated.id % 4 when 0 then 'email' when 1 then 'chat' when 2 then 'phone' else 'portal' end,
    concat('Fixture support ticket ', generated.id),
    dateadd(second, -(generated.id % 1209600), sysutcdatetime()),
    case when generated.id % 5 in (3, 4) then dateadd(second, -(generated.id % 604800), sysutcdatetime()) else null end
  );
go

if not exists (select 1 from sys.foreign_keys where name = 'fk_orders_accounts')
begin
  alter table dbo.orders
    add constraint fk_orders_accounts foreign key (account_id) references dbo.accounts(id);
end
go

if not exists (select 1 from sys.foreign_keys where name = 'fk_order_items_orders')
begin
  alter table dbo.order_items
    add constraint fk_order_items_orders foreign key (order_id) references dbo.orders(order_id);
end
go

if not exists (select 1 from sys.foreign_keys where name = 'fk_order_items_products')
begin
  alter table dbo.order_items
    add constraint fk_order_items_products foreign key (sku) references dbo.products(sku);
end
go

if not exists (select 1 from sys.foreign_keys where name = 'fk_support_tickets_accounts')
begin
  alter table dbo.support_tickets
    add constraint fk_support_tickets_accounts foreign key (account_id) references dbo.accounts(id);
end
go

create or alter view dbo.order_fulfillment_summary as
select
  orders.account_id,
  accounts.name as account_name,
  orders.status,
  count_big(*) as order_count,
  sum(orders.total_amount) as total_amount
from dbo.orders orders
join dbo.accounts accounts on accounts.id = orders.account_id
group by orders.account_id, accounts.name, orders.status;
go

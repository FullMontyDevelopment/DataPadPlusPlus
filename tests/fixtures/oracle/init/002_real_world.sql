begin
  execute immediate 'create table order_items (
    order_id number not null,
    line_number number not null,
    sku varchar2(64) not null,
    quantity number not null,
    unit_price number(12,2) not null,
    discount number(5,2) default 0 not null,
    constraint pk_order_items primary key (order_id, line_number)
  )';
exception when others then
  if sqlcode != -955 then raise; end if;
end;
/

begin
  execute immediate 'create table support_tickets (
    ticket_id number primary key,
    account_id number not null,
    priority varchar2(32) not null,
    status varchar2(32) not null,
    channel varchar2(32) not null,
    subject varchar2(255) not null,
    created_at timestamp not null,
    resolved_at timestamp
  )';
exception when others then
  if sqlcode != -955 then raise; end if;
end;
/

merge into accounts target
using (
  select level + 3 as id from dual connect by level <= 497
) generated
on (target.id = generated.id)
when matched then update set
  name = 'Fixture Account ' || generated.id,
  status = case mod(generated.id, 6) when 0 then 'paused' when 1 then 'trial' else 'active' end,
  updated_at = systimestamp - numtodsinterval(mod(generated.id, 1440), 'MINUTE')
when not matched then insert (id, name, status, updated_at)
values (
  generated.id,
  'Fixture Account ' || generated.id,
  case mod(generated.id, 6) when 0 then 'paused' when 1 then 'trial' else 'active' end,
  systimestamp - numtodsinterval(mod(generated.id, 1440), 'MINUTE')
);

merge into orders target
using (
  select level as id from dual connect by level <= 25000
) generated
on (target.order_id = 1000 + generated.id)
when matched then update set
  account_id = mod(generated.id, 500) + 1,
  status = case mod(generated.id, 7) when 0 then 'created' when 1 then 'processing' when 2 then 'paid' when 3 then 'fulfilled' when 4 then 'returned' when 5 then 'cancelled' else 'on-hold' end,
  total_amount = (mod(generated.id, 20000) / 4.0) + 25,
  updated_at = systimestamp - numtodsinterval(mod(generated.id, 259200), 'SECOND')
when not matched then insert (order_id, account_id, status, total_amount, updated_at)
values (
  1000 + generated.id,
  mod(generated.id, 500) + 1,
  case mod(generated.id, 7) when 0 then 'created' when 1 then 'processing' when 2 then 'paid' when 3 then 'fulfilled' when 4 then 'returned' when 5 then 'cancelled' else 'on-hold' end,
  (mod(generated.id, 20000) / 4.0) + 25,
  systimestamp - numtodsinterval(mod(generated.id, 259200), 'SECOND')
);

merge into order_items target
using (
  select
    1000 + order_source.id as order_id,
    line_source.line_number,
    'sku-' || lpad(to_char(mod(order_source.id + line_source.line_number, 1000) + 1), 4, '0') as sku,
    mod(order_source.id + line_source.line_number, 4) + 1 as quantity,
    round((mod(order_source.id, 500) / 2.5) + 12, 2) as unit_price,
    round(mod(line_source.line_number, 3) * 2.5, 2) as discount
  from (select level as id from dual connect by level <= 25000) order_source
  cross join (select level as line_number from dual connect by level <= 3) line_source
) generated
on (
  target.order_id = generated.order_id
  and target.line_number = generated.line_number
)
when matched then update set
  sku = generated.sku,
  quantity = generated.quantity,
  unit_price = generated.unit_price,
  discount = generated.discount
when not matched then insert (order_id, line_number, sku, quantity, unit_price, discount)
values (
  generated.order_id,
  generated.line_number,
  generated.sku,
  generated.quantity,
  generated.unit_price,
  generated.discount
);

merge into support_tickets target
using (
  select level as id from dual connect by level <= 5000
) generated
on (target.ticket_id = generated.id)
when matched then update set
  account_id = mod(generated.id, 500) + 1,
  priority = case mod(generated.id, 4) when 0 then 'critical' when 1 then 'high' when 2 then 'normal' else 'low' end,
  status = case mod(generated.id, 5) when 0 then 'open' when 1 then 'assigned' when 2 then 'waiting-on-customer' else 'resolved' end,
  channel = case mod(generated.id, 4) when 0 then 'email' when 1 then 'chat' when 2 then 'phone' else 'portal' end,
  subject = 'Fixture support ticket ' || generated.id,
  created_at = systimestamp - numtodsinterval(mod(generated.id, 1209600), 'SECOND'),
  resolved_at = case when mod(generated.id, 5) in (3, 4) then systimestamp - numtodsinterval(mod(generated.id, 604800), 'SECOND') else null end
when not matched then insert (ticket_id, account_id, priority, status, channel, subject, created_at, resolved_at)
values (
  generated.id,
  mod(generated.id, 500) + 1,
  case mod(generated.id, 4) when 0 then 'critical' when 1 then 'high' when 2 then 'normal' else 'low' end,
  case mod(generated.id, 5) when 0 then 'open' when 1 then 'assigned' when 2 then 'waiting-on-customer' else 'resolved' end,
  case mod(generated.id, 4) when 0 then 'email' when 1 then 'chat' when 2 then 'phone' else 'portal' end,
  'Fixture support ticket ' || generated.id,
  systimestamp - numtodsinterval(mod(generated.id, 1209600), 'SECOND'),
  case when mod(generated.id, 5) in (3, 4) then systimestamp - numtodsinterval(mod(generated.id, 604800), 'SECOND') else null end
);

declare
  constraint_count number;
begin
  select count(*)
  into constraint_count
  from user_constraints
  where constraint_name = 'FK_ORDERS_ACCOUNTS';

  if constraint_count = 0 then
    execute immediate 'alter table orders add constraint fk_orders_accounts foreign key (account_id) references accounts(id)';
  end if;
end;
/

declare
  constraint_count number;
begin
  select count(*)
  into constraint_count
  from user_constraints
  where constraint_name = 'FK_ORDER_ITEMS_ORDERS';

  if constraint_count = 0 then
    execute immediate 'alter table order_items add constraint fk_order_items_orders foreign key (order_id) references orders(order_id)';
  end if;
end;
/

declare
  constraint_count number;
begin
  select count(*)
  into constraint_count
  from user_constraints
  where constraint_name = 'FK_SUPPORT_TICKETS_ACCOUNTS';

  if constraint_count = 0 then
    execute immediate 'alter table support_tickets add constraint fk_support_tickets_accounts foreign key (account_id) references accounts(id)';
  end if;
end;
/

begin
  execute immediate 'create index order_items_sku_idx on order_items (sku)';
exception when others then
  if sqlcode != -955 then raise; end if;
end;
/

begin
  execute immediate 'create index support_tickets_account_idx on support_tickets (account_id, status)';
exception when others then
  if sqlcode != -955 then raise; end if;
end;
/

create or replace view order_fulfillment_summary as
select
  orders.account_id,
  orders.status,
  count(*) as order_count,
  sum(orders.total_amount) as total_amount,
  avg(items.line_count) as average_line_count
from orders
left join (
  select order_id, count(*) as line_count
  from order_items
  group by order_id
) items on items.order_id = orders.order_id
group by orders.account_id, orders.status;

commit;

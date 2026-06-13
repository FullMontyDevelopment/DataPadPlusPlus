mkdb datapadplusplus
cd datapadplusplus

mkcon accounts /id
mkcon products /sku
mkcon orders /accountId
mkcon order_events /pk

mkitem -container accounts '{"id":"1","name":"Northwind","status":"active","tier":"enterprise","region":"eu-west-1"}'
mkitem -container accounts '{"id":"2","name":"Contoso","status":"active","tier":"growth","region":"us-east-1"}'
mkitem -container accounts '{"id":"3","name":"Fabrikam","status":"paused","tier":"starter","region":"af-south-1"}'

mkitem -container products '{"id":"luna-lamp","sku":"luna-lamp","name":"Luna Lamp","category":"lighting","inventory_available":18,"price":49.99}'
mkitem -container products '{"id":"aurora-desk","sku":"aurora-desk","name":"Aurora Desk","category":"furniture","inventory_available":8,"price":349.00}'
mkitem -container products '{"id":"nova-chair","sku":"nova-chair","name":"Nova Chair","category":"office","inventory_available":24,"price":129.95}'

mkitem -container orders '{"id":"order-101","accountId":"1","status":"processing","region":"eu-west-1","total":128.40,"items":[{"sku":"luna-lamp","quantity":2},{"sku":"nova-chair","quantity":1}]}'
mkitem -container orders '{"id":"order-102","accountId":"2","status":"fulfilled","region":"us-east-1","total":88.00,"items":[{"sku":"luna-lamp","quantity":1}]}'
mkitem -container orders '{"id":"order-103","accountId":"3","status":"on-hold","region":"af-south-1","total":349.00,"items":[{"sku":"aurora-desk","quantity":1}]}'

mkitem -container order_events '{"id":"event-101-created","pk":"ACCOUNT#1","sk":"ORDER#101#EVENT#000001","orderId":"order-101","status":"created","amount":128.40}'
mkitem -container order_events '{"id":"event-101-processing","pk":"ACCOUNT#1","sk":"ORDER#101#EVENT#000002","orderId":"order-101","status":"processing","amount":128.40}'
mkitem -container order_events '{"id":"event-102-fulfilled","pk":"ACCOUNT#2","sk":"ORDER#102#EVENT#000001","orderId":"order-102","status":"fulfilled","amount":88.00}'

query "SELECT VALUE COUNT(1) FROM c" --container=orders

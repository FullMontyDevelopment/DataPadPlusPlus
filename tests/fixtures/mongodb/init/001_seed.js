db = db.getSiblingDB('catalog');

if (!db.getUser('datapadplusplus')) {
  db.createUser({
    user: 'datapadplusplus',
    pwd: 'datapadplusplus',
    roles: [{ role: 'readWrite', db: 'catalog' }],
  });
}

db.products.updateOne(
  { sku: 'luna-lamp' },
  {
    $set: {
      sku: 'luna-lamp',
      channels: ['web', 'store'],
      inventory: { reserved: 4, available: 18 },
      updatedAt: new Date(),
    },
  },
  { upsert: true },
);

db.products.updateOne(
  { sku: 'aurora-desk' },
  {
    $set: {
      sku: 'aurora-desk',
      channels: ['web'],
      inventory: { reserved: 1, available: 8 },
      updatedAt: new Date(),
    },
  },
  { upsert: true },
);

db.products.updateOne(
  { sku: 'nova-chair' },
  {
    $set: {
      sku: 'nova-chair',
      name: 'Nova Chair',
      category: 'furniture',
      channels: ['store'],
      inventory: { reserved: 2, available: 24 },
      price: 129.5,
      updatedAt: new Date(),
    },
  },
  { upsert: true },
);

db.accounts.updateOne(
  { _id: 1 },
  {
    $set: {
      name: 'Northwind',
      status: 'active',
      tier: 'enterprise',
      contacts: [{ name: 'Avery Stone', role: 'buyer', email: 'avery@example.test' }],
      updatedAt: new Date(),
    },
  },
  { upsert: true },
);

db.accounts.updateOne(
  { _id: 2 },
  {
    $set: {
      name: 'Contoso',
      status: 'active',
      tier: 'growth',
      contacts: [{ name: 'Jordan Lee', role: 'ops', email: 'jordan@example.test' }],
      updatedAt: new Date(),
    },
  },
  { upsert: true },
);

db.orders.updateOne(
  { _id: 101 },
  {
    $set: {
      accountId: 1,
      status: 'processing',
      totalAmount: 128.4,
      items: [
        { sku: 'luna-lamp', quantity: 2, unitPrice: 49.99 },
        { sku: 'nova-chair', quantity: 1, unitPrice: 28.42 },
      ],
      events: [
        { type: 'created', at: new Date('2026-01-01T00:00:00Z') },
        { type: 'paid', at: new Date('2026-01-01T00:01:30Z') },
      ],
      updatedAt: new Date(),
    },
  },
  { upsert: true },
);

db.orders.updateOne(
  { _id: 102 },
  {
    $set: {
      accountId: 2,
      status: 'fulfilled',
      totalAmount: 88,
      items: [{ sku: 'aurora-desk', quantity: 1, unitPrice: 88 }],
      events: [
        { type: 'created', at: new Date('2026-01-01T00:02:00Z') },
        { type: 'fulfilled', at: new Date('2026-01-01T00:10:00Z') },
      ],
      updatedAt: new Date(),
    },
  },
  { upsert: true },
);

db.products.createIndex({ sku: 1 }, { unique: true });
db.products.createIndex({ category: 1 });
db.accounts.createIndex({ status: 1, tier: 1 });
db.orders.createIndex({ accountId: 1, status: 1 });

function flushBulk(collection, operations) {
  if (operations.length === 0) {
    return;
  }

  collection.bulkWrite(operations, { ordered: false });
  operations.length = 0;
}

let bulk = [];

for (let id = 4; id <= 500; id += 1) {
  bulk.push({
    updateOne: {
      filter: { _id: id },
      update: {
        $set: {
          name: `Fixture Account ${id}`,
          status: id % 6 === 0 ? 'paused' : id % 6 === 1 ? 'trial' : 'active',
          tier: ['enterprise', 'growth', 'starter', 'scale'][id % 4],
          contacts: [
            {
              name: `Fixture Buyer ${id}`,
              role: 'buyer',
              email: `buyer-${id}@example.test`,
              phone: `+1-555-${String(id).padStart(4, '0')}`,
            },
            {
              name: `Fixture Ops ${id}`,
              role: 'operations',
              email: `ops-${id}@example.test`,
            },
          ],
          billing: {
            currency: ['USD', 'EUR', 'GBP', 'ZAR'][id % 4],
            creditLimit: 5000 + id * 25,
            paymentTerms: id % 3 === 0 ? 'net-60' : 'net-30',
          },
          updatedAt: new Date(Date.now() - (id % 1440) * 60 * 1000),
        },
      },
      upsert: true,
    },
  });

  if (bulk.length >= 500) flushBulk(db.accounts, bulk);
}

flushBulk(db.accounts, bulk);

for (let id = 1; id <= 1000; id += 1) {
  const sku = `sku-${String(id).padStart(4, '0')}`;
  bulk.push({
    updateOne: {
      filter: { sku },
      update: {
        $set: {
          sku,
          name: `Fixture Product ${id}`,
          category: ['lighting', 'furniture', 'storage', 'audio', 'office', 'accessories'][id % 6],
          channels: id % 3 === 0 ? ['web', 'store', 'partner'] : ['web'],
          inventory: {
            reserved: id % 17,
            available: (id * 17) % 250,
            warehouses: {
              'eu-west-1': id % 40,
              'us-east-1': (id * 3) % 55,
              local: (id * 7) % 30,
            },
          },
          price: Number(((id % 500) / 2.5 + 12).toFixed(2)),
          attributes: {
            color: ['black', 'white', 'oak', 'graphite', 'blue'][id % 5],
            weightKg: Number(((id % 50) / 3 + 1).toFixed(2)),
            fragile: id % 11 === 0,
          },
          updatedAt: new Date(Date.now() - (id % 720) * 60 * 1000),
        },
      },
      upsert: true,
    },
  });

  if (bulk.length >= 500) flushBulk(db.products, bulk);
}

flushBulk(db.products, bulk);

for (let id = 1; id <= 25000; id += 1) {
  const orderId = 1000 + id;
  bulk.push({
    updateOne: {
      filter: { _id: orderId },
      update: {
        $set: {
          accountId: (id % 500) + 1,
          status: ['created', 'processing', 'paid', 'fulfilled', 'returned', 'cancelled', 'on-hold'][id % 7],
          totalAmount: Number(((id % 20000) / 4 + 25).toFixed(2)),
          items: [1, 2, 3].map((line) => ({
            sku: `sku-${String(((id + line) % 1000) + 1).padStart(4, '0')}`,
            quantity: ((id + line) % 4) + 1,
            unitPrice: Number((((id + line) % 500) / 2.5 + 12).toFixed(2)),
            discount: (id + line) % 10 === 0 ? 10 : 0,
          })),
          fulfillment: {
            warehouse: ['eu-west-1', 'us-east-1', 'ap-southeast-1', 'af-south-1', 'local'][id % 5],
            carrier: ['DHL', 'UPS', 'FedEx', 'Local Courier'][id % 4],
            tracking: `TRK-${String(orderId).padStart(8, '0')}`,
          },
          events: [
            { type: 'created', at: new Date(Date.now() - (id % 259200) * 1000) },
            { type: 'validated', at: new Date(Date.now() - (id % 250000) * 1000) },
            { type: id % 7 === 3 ? 'fulfilled' : 'updated', at: new Date(Date.now() - (id % 240000) * 1000) },
          ],
          updatedAt: new Date(Date.now() - (id % 259200) * 1000),
        },
      },
      upsert: true,
    },
  });

  if (bulk.length >= 1000) flushBulk(db.orders, bulk);
}

flushBulk(db.orders, bulk);

const largeDocumentTargetCount = 12;
const largeDocuments = db.largeDocuments;
const currentLargeDocumentCount = largeDocuments.estimatedDocumentCount();

if (currentLargeDocumentCount < largeDocumentTargetCount) {
  largeDocuments.deleteMany({});
  const chunkText = 'fixture-payload-segment:'.repeat(128);

  for (let id = 1; id <= largeDocumentTargetCount; id += 1) {
    bulk.push({
      insertOne: {
        document: {
          _id: id,
          title: `Large fixture document ${id}`,
          accountId: (id % 500) + 1,
          createdAt: new Date(Date.now() - id * 60000),
          sections: Array.from({ length: 80 }, (_, section) => ({
            section,
            label: `section-${section}`,
            metrics: {
              score: (id * section) % 1000,
              latencyMs: Number((((id + section) % 500) / 7 + 10).toFixed(2)),
            },
            entries: Array.from({ length: 10 }, (_, entry) => ({
              entry,
              key: `key-${section}-${entry}`,
              value: `${chunkText}${id}-${section}-${entry}`,
              flags: {
                active: (id + section + entry) % 2 === 0,
                reviewed: (id + entry) % 3 === 0,
              },
            })),
          })),
        },
      },
    });

    if (bulk.length >= 10) flushBulk(largeDocuments, bulk);
  }

  flushBulk(largeDocuments, bulk);
}

db.accounts.createIndex({ status: 1, tier: 1 });
db.products.createIndex({ category: 1, 'inventory.available': -1 });
db.orders.createIndex({ accountId: 1, updatedAt: -1 });
db.orders.createIndex({ status: 1, totalAmount: -1 });
db.largeDocuments.createIndex({ accountId: 1, createdAt: -1 });

const perfTargetCount = 150000;
const perfCollection = db.perfDocuments;
const existingPerfCount = perfCollection.estimatedDocumentCount();

if (existingPerfCount < perfTargetCount) {
  perfCollection.deleteMany({});

  const regions = ['eu-west-1', 'us-east-1', 'ap-southeast-1', 'af-south-1', 'local'];
  const events = ['order.created', 'order.updated', 'inventory.adjusted', 'session.heartbeat'];
  const batch = [];

  for (let id = 1; id <= perfTargetCount; id += 1) {
    batch.push({
      _id: id,
      accountId: (id % 250) + 1,
      region: regions[id % regions.length],
      eventName: events[id % events.length],
      amount: Number(((id % 10000) / 3 + 10).toFixed(2)),
      createdAt: new Date(Date.now() - (id % 43200) * 1000),
      tags: [`sku-${String(id % 1000).padStart(4, '0')}`, id % 2 === 0 ? 'even' : 'odd'],
      payload: {
        sequence: id,
        shard: id % 32,
        synthetic: true,
      },
    });

    if (batch.length >= 1000) {
      perfCollection.insertMany(batch, { ordered: false });
      batch.length = 0;
    }
  }

  if (batch.length > 0) {
    perfCollection.insertMany(batch, { ordered: false });
  }
}

perfCollection.createIndex({ accountId: 1, createdAt: -1 });
perfCollection.createIndex({ region: 1 });
perfCollection.createIndex({ eventName: 1 });

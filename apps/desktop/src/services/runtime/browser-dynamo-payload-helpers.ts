export function emptyDynamoTablePayload(
  region: string,
  tableName: string,
  objectView: string,
) {
  return {
    engine: 'dynamodb',
    region,
    objectView,
    tableName,
    objectName: tableName,
    tables: [],
    items: [],
    keys: [],
    globalSecondaryIndexes: [],
    localSecondaryIndexes: [],
    streams: [],
    ttl: [],
    capacity: [],
    hotPartitions: [],
    alarms: [],
    backups: [],
    permissions: [],
    warnings: [
      'No DynamoDB table metadata is available. Refresh the Tables node or select another table.',
    ],
  }
}

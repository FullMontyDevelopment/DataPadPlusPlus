import type { MongoDbConnectionOptions } from '@datapadplusplus/shared-types'
import { validateOptionalText } from '../common/request-validation-core'

export function validateMongoDbConnectionOptions(
  options: MongoDbConnectionOptions | undefined,
): MongoDbConnectionOptions | undefined {
  if (!options) return undefined
  if (typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('MongoDB connection options must be an object.')
  }

  const connectionScheme = validateOptionalText(
    options.connectionScheme,
    'MongoDB connection scheme',
    32,
  )?.trim()
  if (
    connectionScheme &&
    connectionScheme !== 'mongodb' &&
    connectionScheme !== 'mongodb+srv'
  ) {
    throw new Error('MongoDB connection scheme is invalid.')
  }
  if (options.tls !== undefined && typeof options.tls !== 'boolean') {
    throw new Error('MongoDB TLS must be true or false.')
  }

  return {
    connectionScheme: connectionScheme as MongoDbConnectionOptions['connectionScheme'],
    authSource:
      validateOptionalText(options.authSource, 'MongoDB auth source', 128)?.trim()
      || undefined,
    appName:
      validateOptionalText(options.appName, 'MongoDB app name', 128)?.trim() || undefined,
    tls: options.tls,
    replicaSet:
      validateOptionalText(options.replicaSet, 'MongoDB replica set', 128)?.trim()
      || undefined,
  }
}

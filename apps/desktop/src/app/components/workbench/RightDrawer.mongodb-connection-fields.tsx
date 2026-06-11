import type {
  ConnectionProfile,
  MongoDbConnectionOptions,
} from '@datapadplusplus/shared-types'
import { FormField } from './RightDrawer.primitives'

type UpdateConnectionDraft = (
  patch: Partial<ConnectionProfile>,
  options?: { preserveName?: boolean },
) => void

export function MongoDbNativeConnectionFields({
  connectionDraft,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  const options = connectionDraft.mongodbOptions ?? {}
  const scheme = options.connectionScheme ?? 'mongodb'

  return (
    <FormField label="MongoDB deployment">
      <select
        aria-label="MongoDB deployment"
        value={scheme}
        onChange={(event) => {
          const nextScheme = event.target.value as MongoDbConnectionOptions['connectionScheme']
          onUpdateConnectionDraft({
            port: nextScheme === 'mongodb+srv' ? undefined : connectionDraft.port ?? 27017,
            mongodbOptions: {
              ...options,
              connectionScheme: nextScheme,
              tls: nextScheme === 'mongodb+srv' ? true : options.tls,
              authSource: options.authSource ?? 'admin',
              appName: options.appName ?? 'DataPadPlusPlus',
            },
          })
        }}
      >
        <option value="mongodb">Standard MongoDB host / seed list</option>
        <option value="mongodb+srv">MongoDB Atlas SRV host</option>
      </select>
    </FormField>
  )
}

export function MongoDbNativeAdvancedFields({
  connectionDraft,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  const options = connectionDraft.mongodbOptions ?? {}
  const scheme = options.connectionScheme ?? 'mongodb'
  const updateOptions = (patch: Partial<MongoDbConnectionOptions>) =>
    onUpdateConnectionDraft({
      mongodbOptions: {
        ...options,
        ...patch,
      },
    })

  return (
    <>
      <FormField label="Auth source">
        <input
          aria-label="MongoDB auth source"
          value={options.authSource ?? ''}
          placeholder="admin"
          onChange={(event) => updateOptions({ authSource: event.target.value || undefined })}
        />
      </FormField>

      <FormField label="App name">
        <input
          aria-label="MongoDB app name"
          value={options.appName ?? ''}
          placeholder="DataPadPlusPlus"
          onChange={(event) => updateOptions({ appName: event.target.value || undefined })}
        />
      </FormField>

      <FormField label="TLS">
        <select
          aria-label="MongoDB TLS"
          value={String(options.tls ?? scheme === 'mongodb+srv')}
          onChange={(event) => updateOptions({ tls: event.target.value === 'true' })}
        >
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </select>
      </FormField>

      {scheme === 'mongodb' ? (
        <FormField label="Replica set">
          <input
            aria-label="MongoDB replica set"
            value={options.replicaSet ?? ''}
            placeholder="atlas-10jff9-shard-0"
            onChange={(event) => updateOptions({ replicaSet: event.target.value || undefined })}
          />
        </FormField>
      ) : null}
    </>
  )
}

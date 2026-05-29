import type {
  ConnectionMode,
  ConnectionProfile,
  DynamoDbConnectionOptions,
} from '@datapadplusplus/shared-types'
import type { UpdateConnectionDraft } from './RightDrawer.connection-modes'
import { FormField } from './RightDrawer.primitives'

const CONNECT_MODE_LABELS: Array<{
  value: NonNullable<DynamoDbConnectionOptions['connectMode']>
  label: string
}> = [
  { value: 'local-endpoint', label: 'Local endpoint' },
  { value: 'aws-profile', label: 'AWS profile' },
  { value: 'access-keys', label: 'Access keys' },
  { value: 'assume-role', label: 'Assume role' },
  { value: 'web-identity', label: 'Web identity' },
  { value: 'ecs-task', label: 'ECS task' },
  { value: 'ec2-instance', label: 'EC2 instance' },
  { value: 'endpoint-override', label: 'Endpoint override' },
]

export function DynamoDbConnectionFields({
  connectionDraft,
  mode,
  secretDraft,
  onSecretDraftChange,
  onUpdateConnectionDraft,
}: {
  connectionDraft: ConnectionProfile
  mode: Extract<ConnectionMode, 'cloud-iam' | 'cloud-sdk'>
  secretDraft: string
  onSecretDraftChange(value: string): void
  onUpdateConnectionDraft: UpdateConnectionDraft
}) {
  const options = connectionDraft.dynamoDbOptions ?? {}
  const connectMode = options.connectMode ?? (mode === 'cloud-sdk' ? 'aws-profile' : 'assume-role')
  const credentialsProvider = options.credentialsProvider ?? providerForMode(connectMode)
  const showEndpoint =
    connectMode === 'local-endpoint' || connectMode === 'endpoint-override'
  const showProfile = connectMode === 'aws-profile'
  const showKeys = connectMode === 'access-keys'
  const showRole = connectMode === 'assume-role'
  const showWebIdentity = connectMode === 'web-identity'

  const updateOptions = (patch: Partial<DynamoDbConnectionOptions>) =>
    onUpdateConnectionDraft({
      dynamoDbOptions: {
        connectMode,
        credentialsProvider,
        ...options,
        ...patch,
      },
    })

  const updateConnectMode = (value: DynamoDbConnectionOptions['connectMode']) => {
    updateOptions({
      connectMode: value,
      credentialsProvider: providerForMode(value),
    })
  }

  return (
    <div className="connection-advanced-section" aria-label="DynamoDB connection options">
      <strong>DynamoDB options</strong>

      <div className="connection-advanced-grid">
        <FormField label="Mode">
          <select
            aria-label="DynamoDB connection mode"
            value={connectMode}
            onChange={(event) =>
              updateConnectMode(event.target.value as DynamoDbConnectionOptions['connectMode'])
            }
          >
            {CONNECT_MODE_LABELS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Region">
          <input
            aria-label="DynamoDB region"
            value={options.region ?? connectionDraft.database ?? ''}
            placeholder="us-east-1"
            onChange={(event) => {
              updateOptions({ region: event.target.value || undefined })
              onUpdateConnectionDraft(
                { database: event.target.value || undefined },
                { preserveName: true },
              )
            }}
          />
        </FormField>
      </div>

      {showEndpoint ? (
        <FormField label="Endpoint">
          <input
            aria-label="DynamoDB endpoint URL"
            value={options.endpointUrl ?? connectionDraft.host ?? ''}
            placeholder="http://localhost:8000"
            onChange={(event) => {
              updateOptions({ endpointUrl: event.target.value || undefined })
              onUpdateConnectionDraft({ host: event.target.value || '' }, { preserveName: true })
            }}
          />
        </FormField>
      ) : null}

      {showProfile ? (
        <FormField label="Profile">
          <input
            aria-label="DynamoDB profile name"
            value={options.profileName ?? ''}
            placeholder="default"
            onChange={(event) =>
              updateOptions({ profileName: event.target.value || undefined })
            }
          />
        </FormField>
      ) : null}

      {showKeys ? (
        <div className="connection-advanced-grid">
          <FormField label="Access key">
            <input
              aria-label="DynamoDB access key ID"
              value={options.accessKeyId ?? ''}
              onChange={(event) =>
                updateOptions({ accessKeyId: event.target.value || undefined })
              }
            />
          </FormField>
          <FormField label="Secret key">
            <input
              aria-label="DynamoDB credential"
              type="password"
              autoComplete="new-password"
              value={secretDraft}
              placeholder={
                connectionDraft.auth.secretRef ? 'Stored credential' : 'Secret access key'
              }
              onChange={(event) => onSecretDraftChange(event.target.value)}
            />
          </FormField>
        </div>
      ) : null}

      {showRole ? (
        <div className="connection-advanced-grid">
          <FormField label="Role ARN">
            <input
              aria-label="DynamoDB role ARN"
              value={options.roleArn ?? ''}
              placeholder="arn:aws:iam::123456789012:role/DataPadReadOnly"
              onChange={(event) => updateOptions({ roleArn: event.target.value || undefined })}
            />
          </FormField>
          <FormField label="Session">
            <input
              aria-label="DynamoDB role session name"
              value={options.roleSessionName ?? ''}
              placeholder="datapad"
              onChange={(event) =>
                updateOptions({ roleSessionName: event.target.value || undefined })
              }
            />
          </FormField>
        </div>
      ) : null}

      {showWebIdentity ? (
        <div className="connection-advanced-grid">
          <FormField label="Role ARN">
            <input
              aria-label="DynamoDB web identity role ARN"
              value={options.roleArn ?? ''}
              onChange={(event) => updateOptions({ roleArn: event.target.value || undefined })}
            />
          </FormField>
          <FormField label="Token file">
            <input
              aria-label="DynamoDB web identity token file"
              value={options.webIdentityTokenFile ?? ''}
              onChange={(event) =>
                updateOptions({ webIdentityTokenFile: event.target.value || undefined })
              }
            />
          </FormField>
        </div>
      ) : null}

      <div className="connection-advanced-grid">
        <FormField label="Table prefix">
          <input
            aria-label="DynamoDB table prefix"
            value={options.tablePrefix ?? ''}
            placeholder="qa_"
            onChange={(event) =>
              updateOptions({ tablePrefix: event.target.value || undefined })
            }
          />
        </FormField>
        <FormField label="Capacity">
          <select
            aria-label="DynamoDB return consumed capacity"
            value={options.returnConsumedCapacity ?? 'none'}
            onChange={(event) =>
              updateOptions({
                returnConsumedCapacity:
                  event.target.value as DynamoDbConnectionOptions['returnConsumedCapacity'],
              })
            }
          >
            <option value="none">None</option>
            <option value="total">Total</option>
            <option value="indexes">Indexes</option>
          </select>
        </FormField>
      </div>

      <div className="connection-advanced-grid">
        <FormField label="Retry">
          <select
            aria-label="DynamoDB retry mode"
            value={options.retryMode ?? 'standard'}
            onChange={(event) =>
              updateOptions({ retryMode: event.target.value as DynamoDbConnectionOptions['retryMode'] })
            }
          >
            <option value="standard">Standard</option>
            <option value="adaptive">Adaptive</option>
            <option value="legacy">Legacy</option>
          </select>
        </FormField>
        <FormField label="Attempts">
          <input
            aria-label="DynamoDB max attempts"
            type="number"
            min={1}
            max={20}
            value={options.maxAttempts ?? ''}
            onChange={(event) =>
              updateOptions({ maxAttempts: Number(event.target.value) || undefined })
            }
          />
        </FormField>
      </div>

      <div className="connection-advanced-grid">
        <FormField label="Scan page">
          <input
            aria-label="DynamoDB scan page size"
            type="number"
            min={1}
            max={10000}
            value={options.scanPageSize ?? ''}
            onChange={(event) =>
              updateOptions({ scanPageSize: Number(event.target.value) || undefined })
            }
          />
        </FormField>
        <FormField label="Timeout ms">
          <input
            aria-label="DynamoDB request timeout"
            type="number"
            min={1}
            value={options.requestTimeoutMs ?? ''}
            onChange={(event) =>
              updateOptions({ requestTimeoutMs: Number(event.target.value) || undefined })
            }
          />
        </FormField>
      </div>

      <div className="drawer-checkbox-grid">
        <label>
          <input
            type="checkbox"
            checked={options.consistentReadDefault ?? false}
            onChange={(event) => updateOptions({ consistentReadDefault: event.target.checked })}
          />
          Consistent reads
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.useDualStackEndpoint ?? false}
            onChange={(event) => updateOptions({ useDualStackEndpoint: event.target.checked })}
          />
          Dual-stack
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.useFipsEndpoint ?? false}
            onChange={(event) => updateOptions({ useFipsEndpoint: event.target.checked })}
          />
          FIPS
        </label>
        <label>
          <input
            type="checkbox"
            checked={options.forcePathStyle ?? showEndpoint}
            onChange={(event) => updateOptions({ forcePathStyle: event.target.checked })}
          />
          Path style
        </label>
      </div>
    </div>
  )
}

function providerForMode(
  mode: DynamoDbConnectionOptions['connectMode'],
): DynamoDbConnectionOptions['credentialsProvider'] {
  if (mode === 'aws-profile') {
    return 'profile'
  }
  if (mode === 'access-keys') {
    return 'static-keys'
  }
  if (mode === 'assume-role') {
    return 'assume-role'
  }
  if (mode === 'web-identity') {
    return 'web-identity'
  }
  if (mode === 'ecs-task') {
    return 'container'
  }
  if (mode === 'ec2-instance') {
    return 'instance-metadata'
  }
  return 'default-chain'
}

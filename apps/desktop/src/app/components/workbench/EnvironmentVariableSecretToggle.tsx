import { LockIcon, UnlockIcon } from './icons'

export function EnvironmentVariableSecretToggle({
  label,
  onToggle,
  secret,
}: {
  label: string
  onToggle(): void
  secret: boolean
}) {
  const Icon = secret ? LockIcon : UnlockIcon
  const title = secret ? 'Stored as secret' : 'Stored as text'

  return (
    <button
      type="button"
      className={`environment-variable-kind-toggle${secret ? ' is-secret' : ''}`}
      aria-label={label}
      aria-pressed={secret}
      title={title}
      onClick={onToggle}
    >
      <Icon className="toolbar-icon" />
    </button>
  )
}

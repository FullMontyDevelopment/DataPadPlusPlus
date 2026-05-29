export function formatSecretStorageStatus(value: string) {
  return value === 'keyring'
    ? 'Secure store'
    : value === 'encrypted-file'
      ? 'Encrypted file'
      : value || 'Unavailable'
}

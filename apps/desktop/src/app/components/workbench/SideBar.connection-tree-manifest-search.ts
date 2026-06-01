import { normalizeKind } from './SideBar.connection-tree-manifest-common'

export function searchManifestNodeId(kind: string, label: string, parentPath: string[]) {
  const normalizedKind = normalizeKind(kind)
  const normalizedLabel = normalizeKind(label)
  const underCluster = parentPath.includes('Cluster')
  const underTemplates = parentPath.includes('Templates')
  const underSecurity = parentPath.includes('Security')
  const underDiagnostics = parentPath.includes('Diagnostics')

  if (normalizedKind === 'cluster') return 'search:cluster'
  if (underCluster) {
    return normalizedKind === 'shards'
      ? 'search:cluster:allocation'
      : `search:cluster:${normalizedKind || normalizedLabel}`
  }
  if (normalizedKind === 'indices') return 'search:indices'
  if (normalizedKind === 'data-streams') return 'search:data-streams'
  if (normalizedKind === 'aliases') return 'search:aliases'
  if (normalizedKind === 'templates') return 'search:templates'
  if (underTemplates) {
    return normalizedLabel.includes('component')
      ? 'search:templates:component'
      : 'search:templates:index'
  }
  if (normalizedKind === 'pipelines') return 'search:pipelines'
  if (normalizedKind === 'security') return 'search:security'
  if (underSecurity && ['users', 'roles', 'api-keys'].includes(normalizedKind)) {
    return `search:security:${normalizedKind}`
  }
  if (normalizedKind === 'diagnostics') return 'search:diagnostics'
  if (underDiagnostics) {
    return normalizedKind === 'lifecycle-policies'
      ? 'search:diagnostics:lifecycle'
      : `search:diagnostics:${normalizedKind || normalizedLabel}`
  }

  return `search:${normalizedKind || normalizedLabel || 'object'}`
}

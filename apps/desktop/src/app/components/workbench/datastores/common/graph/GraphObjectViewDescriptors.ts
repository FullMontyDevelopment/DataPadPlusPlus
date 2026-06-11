export type GraphObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const DESCRIPTORS: Record<string, GraphObjectViewDescriptor> = {
  graphs: descriptor('graphs', 'Browse Graphs', 'Graphs', 'Review databases, named graphs, labels, relationship types, indexes, constraints, and graph health.', 'No graphs are loaded', 'Refresh graph metadata or verify the graph endpoint is reachable.'),
  graph: descriptor('graph', 'Open Graph', 'Graph', 'Inspect one graph workspace, schema shape, counts, indexes, constraints, and safe query entry points.', 'Graph metadata is not loaded', 'Refresh this graph or open a scoped graph query.', 'Query Graph'),
  'node-labels': descriptor('node-labels', 'Browse Node Labels', 'Node Labels', 'Review node labels, counts, key properties, and index coverage before writing graph queries.', 'No node labels are loaded', 'Refresh schema metadata for node labels.'),
  'node-label': descriptor('node-label', 'Open Node Label', 'Node Label', 'Inspect one node label, property coverage, relationship connections, indexes, constraints, and query templates.', 'Node label metadata is not loaded', 'Refresh this node label or open a scoped query.', 'Query Nodes'),
  'relationship-types': descriptor('relationship-types', 'Browse Relationship Types', 'Relationship Types', 'Review edge types, direction, connected labels, counts, and indexed properties.', 'No relationship types are loaded', 'Refresh schema metadata for relationship types.'),
  relationship: descriptor('relationship', 'Open Relationship Type', 'Relationship Type', 'Inspect one relationship type, direction, endpoint labels, properties, and query templates.', 'Relationship metadata is not loaded', 'Refresh this relationship type or open a scoped query.', 'Query Relationships'),
  'property-keys': descriptor('property-keys', 'Browse Property Keys', 'Property Keys', 'Review property names, value types, usage, indexed coverage, and data-quality hints.', 'No property keys are loaded', 'Refresh property metadata.'),
  'property-key': descriptor('property-key', 'Open Property Key', 'Property Key', 'Inspect one property key, value types, label usage, and index/constraint coverage.', 'Property metadata is not loaded', 'Refresh this property key.'),
  indexes: descriptor('indexes', 'Manage Indexes', 'Graph Indexes', 'Review schema indexes, provider/type, population state, uniqueness, and guarded index operation previews.', 'No indexes are loaded', 'Refresh index metadata or verify schema privileges.'),
  index: descriptor('index', 'Open Index', 'Graph Index', 'Inspect one graph index, indexed labels/properties, provider, state, and usage guidance.', 'Index metadata is not loaded', 'Refresh this index.'),
  constraints: descriptor('constraints', 'Manage Constraints', 'Graph Constraints', 'Review uniqueness, existence, node-key, and relationship constraints with guarded operation previews.', 'No constraints are loaded', 'Refresh constraint metadata or verify schema privileges.'),
  constraint: descriptor('constraint', 'Open Constraint', 'Graph Constraint', 'Inspect one constraint, target labels/types, properties, and enforcement state.', 'Constraint metadata is not loaded', 'Refresh this constraint.'),
  procedures: descriptor('procedures', 'Review Procedures', 'Procedures', 'Review visible procedures, algorithms, signatures, modes, and permission requirements.', 'No procedures are loaded', 'This graph engine may not expose procedures through metadata.'),
  security: descriptor('security', 'Review Security', 'Graph Security', 'Review visible users, roles, privileges, IAM scope, and disabled management actions.', 'No security metadata is loaded', 'Security metadata may be restricted for this connection.'),
  diagnostics: descriptor('diagnostics', 'Open Diagnostics', 'Graph Diagnostics', 'Review query, storage, transaction, cache, cluster, and schema-health signals.', 'No diagnostics are loaded', 'Refresh diagnostics to collect graph status metadata.'),
}

const DEFAULT_DESCRIPTOR = descriptor(
  'object',
  'Inspect Graph Object',
  'Graph Object',
  'Review available graph metadata for this object.',
  'Graph metadata is not available',
  'Refresh this object or check whether the connection can inspect it.',
)

export function getGraphObjectViewDescriptor(kind: string | undefined): GraphObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[normalizeGraphObjectKind(kind)] ?? DEFAULT_DESCRIPTOR
}

export function graphObjectViewMenuLabel(kind: string | undefined): string {
  return getGraphObjectViewDescriptor(kind).menuLabel
}

export function isGraphObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[normalizeGraphObjectKind(kind)])
}

export const GRAPH_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
  primaryQueryLabel?: string,
): GraphObjectViewDescriptor {
  return {
    kind,
    menuLabel,
    title,
    purpose,
    emptyTitle,
    emptyDescription,
    primaryQueryLabel,
  }
}

function normalizeGraphObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}

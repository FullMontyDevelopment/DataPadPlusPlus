import type { MongoQueryScope } from './mongo-query-scope'

export function MongoScopeSummary({ scope }: { scope?: MongoQueryScope }) {
  if (!scope?.database && !scope?.collection) {
    return null
  }

  return (
    <div className="mongo-query-scope" aria-label="Mongo query scope">
      {scope.database ? (
        <span>
          Database <strong>{scope.database}</strong>
        </span>
      ) : null}
      {scope.collection ? (
        <span>
          Collection <strong>{scope.collection}</strong>
        </span>
      ) : null}
    </div>
  )
}

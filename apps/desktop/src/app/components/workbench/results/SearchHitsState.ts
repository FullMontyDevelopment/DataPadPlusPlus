import { useState } from 'react'
import type { SearchHit } from './search-hit-edit-requests'

export function usePayloadBackedSearchHits(payloadHits: SearchHit[]) {
  const [hitState, setHitState] = useState<{ source: SearchHit[]; hits: SearchHit[] }>({
    source: payloadHits,
    hits: payloadHits,
  })
  const hits = hitState.source === payloadHits ? hitState.hits : payloadHits

  const updateHits = (updater: (current: SearchHit[]) => SearchHit[]) => {
    setHitState((current) => {
      const currentHits = current.source === payloadHits ? current.hits : payloadHits
      return {
        source: payloadHits,
        hits: updater(currentHits),
      }
    })
  }

  return { hits, updateHits }
}

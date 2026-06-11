import { useState } from 'react'
import {
  searchHitId,
  searchHitIndex,
  searchHitScore,
  searchHitSource,
  type SearchHit,
} from '../../../results/search-hit-edit-requests'
import { stringifySearchHitSource } from '../../../results/search-hit-json'

export function usePayloadBackedSearchHits(payloadHits: SearchHit[]) {
  const payloadSignature = searchHitsSignature(payloadHits)
  const [hitState, setHitState] = useState<{
    hits: SearchHit[]
    sourceSignature: string
  }>({
    hits: payloadHits,
    sourceSignature: payloadSignature,
  })
  const hits = hitState.sourceSignature === payloadSignature ? hitState.hits : payloadHits

  const updateHits = (updater: (current: SearchHit[]) => SearchHit[]) => {
    setHitState((current) => {
      const currentHits =
        current.sourceSignature === payloadSignature ? current.hits : payloadHits
      return {
        hits: updater(currentHits),
        sourceSignature: payloadSignature,
      }
    })
  }

  return { hits, updateHits }
}

function searchHitsSignature(hits: SearchHit[]) {
  return hits
    .map((hit, index) =>
      [
        index,
        searchHitIndex(hit),
        searchHitId(hit),
        searchHitScore(hit),
        stringifySearchHitSource(searchHitSource(hit)),
      ].join(':'),
    )
    .join('|')
}

import { describe, expect, it } from 'vitest'
import {
  getSearchObjectViewDescriptor,
  isSearchObjectViewKind,
  searchObjectViewMenuLabel,
} from './SearchObjectViewDescriptors'

describe('SearchObjectViewDescriptors', () => {
  it('uses native workflow labels instead of a generic view label', () => {
    expect(searchObjectViewMenuLabel('index')).toBe('Open Index')
    expect(searchObjectViewMenuLabel('data-stream')).toBe('Open Data Stream')
    expect(searchObjectViewMenuLabel('pipeline')).toBe('Open Pipeline')
    expect(searchObjectViewMenuLabel('diagnostics')).toBe('Open Diagnostics')
    expect(searchObjectViewMenuLabel('index')).not.toBe('Open View')
  })

  it('normalizes common kind spellings', () => {
    expect(getSearchObjectViewDescriptor('DATA_STREAMS').title).toBe('Data Streams')
    expect(getSearchObjectViewDescriptor('api keys').title).toBe('Search API Keys')
    expect(getSearchObjectViewDescriptor('api-keys').title).toBe('Search API Keys')
  })

  it('identifies only implemented search object kinds', () => {
    expect(isSearchObjectViewKind('mappings')).toBe(true)
    expect(isSearchObjectViewKind('unknown')).toBe(false)
  })
})

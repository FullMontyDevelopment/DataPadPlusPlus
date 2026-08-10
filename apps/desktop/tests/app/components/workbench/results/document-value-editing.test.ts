import { describe, expect, it } from 'vitest'
import {
  dateTimeLocalToUtc,
  editableValue,
  parseEditedValue,
} from '../../../../../src/app/components/workbench/results/document-value-editing'

describe('document value codec', () => {
  it('rejects invalid finite numbers instead of silently using zero', () => {
    expect(parseEditedValue('not-a-number', 'number')).toEqual({
      ok: false,
      error: 'Number value must be finite.',
    })
    expect(parseEditedValue('Infinity', 'number').ok).toBe(false)
    expect(parseEditedValue('', 'number').ok).toBe(false)
  })

  it('validates compound native values instead of accepting arbitrary JSON objects', () => {
    expect(parseEditedValue('{"$binary":{"base64":"AA==","subType":"04"}}', 'binary').ok)
      .toBe(true)
    expect(parseEditedValue('{"$binary":{}}', 'binary').ok).toBe(false)
    expect(parseEditedValue('{"$regularExpression":{"pattern":"^a","options":"i"}}', 'regex').ok)
      .toBe(true)
    expect(parseEditedValue('{"$timestamp":{"t":1,"i":2}}', 'timestamp').ok).toBe(true)
    expect(parseEditedValue('{"$timestamp":{"t":"1","i":2}}', 'timestamp').ok).toBe(false)
  })

  it('preserves BSON integer and decimal wrappers without precision loss', () => {
    expect(parseEditedValue('9223372036854775807', 'number', { $numberLong: '1' }))
      .toEqual({ ok: true, value: { $numberLong: '9223372036854775807' } })
    expect(parseEditedValue('1234567890.123456789', 'decimal'))
      .toEqual({ ok: true, value: { $numberDecimal: '1234567890.123456789' } })
    expect(parseEditedValue('2147483648', 'number', { $numberInt: '1' }).ok).toBe(false)
  })

  it('validates canonical ObjectId, UUID, GUID, and timezone-bearing dates', () => {
    expect(parseEditedValue('507f1f77bcf86cd799439011', 'objectid').ok).toBe(true)
    expect(parseEditedValue('00112233-4455-4677-8899-aabbccddeeff', 'uuid'))
      .toEqual({ ok: true, value: { $uuid: '00112233-4455-4677-8899-aabbccddeeff' } })
    expect(parseEditedValue('00112233-4455-4677-8899-aabbccddeeff', 'guid'))
      .toEqual({ ok: true, value: { $guid: '00112233-4455-4677-8899-aabbccddeeff' } })
    expect(parseEditedValue('2026-08-08T12:30:00', 'date').ok).toBe(false)
    expect(parseEditedValue('2026-08-08T12:30:00+02:00', 'date'))
      .toEqual({ ok: true, value: { $date: '2026-08-08T10:30:00.000Z' } })
  })

  it('keeps ordinary JSON strings as strings and converts picker values to UTC', () => {
    expect(parseEditedValue('2026-08-08T12:30:00Z', 'string'))
      .toEqual({ ok: true, value: '2026-08-08T12:30:00Z' })
    const picker = dateTimeLocalToUtc('2026-08-08T12:30')
    expect(picker.ok).toBe(true)
    if (picker.ok) expect(picker.value).toEqual({ $date: expect.stringMatching(/Z$/) })
    expect(editableValue({ $date: { $numberLong: '1770036000000' } }))
      .toBe('2026-02-02T12:40:00.000Z')
  })
})

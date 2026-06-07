import { describe, expect, it } from 'vitest'
import {
  redisDiagnosticDetailRows,
} from './RedisObjectViewMetrics'

describe('RedisObjectViewMetrics', () => {
  it('normalizes SLOWLOG GET command arrays into readable rows', () => {
    expect(redisDiagnosticDetailRows('slowlog', {
      value: [
        [42, 1717500000, 3250, ['HGET', 'cart:42', 'total'], '127.0.0.1:6379', 'desktop'],
      ],
    })).toEqual([
      ['#42', '3.3 ms', 'HGET cart:42 total / 127.0.0.1:6379 / desktop / 1717500000'],
    ])
  })

  it('normalizes LATENCY LATEST samples into native latency rows', () => {
    expect(redisDiagnosticDetailRows('latency', {
      value: [
        ['command', 1717500100, 4, 23],
        ['fork', 1717500200, 1, 6],
      ],
    })).toEqual([
      ['command', '4 ms', 'Max 23 ms / 1717500100'],
      ['fork', '1 ms', 'Max 6 ms / 1717500200'],
    ])
  })

  it('normalizes MEMORY STATS pairs into metric rows', () => {
    expect(redisDiagnosticDetailRows('memory', {
      value: [
        'peak.allocated',
        1048576,
        'allocator-fragmentation.ratio',
        1.25,
      ],
    })).toEqual([
      ['Peak Allocated', '1048576', '1048576'],
      ['Allocator Fragmentation Ratio', '1.25', '1.25'],
    ])
  })

  it('normalizes CLIENT LIST text into client rows', () => {
    expect(redisDiagnosticDetailRows('clients', {
      value: 'id=7 addr=127.0.0.1:58000 name=datapad db=2 cmd=hget age=12 idle=3\nid=8 addr=10.0.0.5:58001 db=0 cmd=scan age=4 idle=0',
    })).toEqual([
      ['datapad', '127.0.0.1:58000', 'db 2, cmd hget, age 12s, idle 3s'],
      ['Client 8', '10.0.0.5:58001', 'db 0, cmd scan, age 4s, idle 0s'],
    ])
  })
})

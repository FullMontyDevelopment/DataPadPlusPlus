import { resolve } from 'node:path'
import { config as baseConfig } from './wdio.docs-screenshots.conf.mjs'

export const config = {
  ...baseConfig,
  specs: [resolve(import.meta.dirname, 'specs', 'docs-common-screenshots.e2e.mjs')],
  mochaOpts: {
    ...baseConfig.mochaOpts,
    grep: 'captures plugin settings and representative plugin workflows',
  },
}

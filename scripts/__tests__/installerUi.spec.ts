import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * install.sh and uninstall.sh are each fetched and run as one file, so the
 * terminal presentation they share cannot live in a third file they source.
 * It is copied between two markers instead, and this is what keeps the copies
 * from drifting: a fix made in one script and not the other fails the build.
 */

const BEGIN = '# >>> installer-ui\n'
const END = '# <<< installer-ui\n'

function sharedBlock(script: string): string {
  const source = readFileSync(join(process.cwd(), 'scripts', script), 'utf8')
  const start = source.indexOf(BEGIN)
  const stop = source.indexOf(END)
  expect(start, `${script} has no ${BEGIN.trim()} marker`).toBeGreaterThanOrEqual(0)
  expect(stop, `${script} has no ${END.trim()} marker`).toBeGreaterThan(start)
  return source.slice(start, stop + END.length)
}

describe('installer presentation', () => {
  it('is the same block in install.sh and uninstall.sh', () => {
    expect(sharedBlock('uninstall.sh')).toBe(sharedBlock('install.sh'))
  })
})

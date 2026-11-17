import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/*
 * The uninstall lives in install.sh, so it can be a plan screen inside the
 * installer, and uninstall.sh only hands over to it. Both scripts ship in every
 * release and are documented as separate entry points, so the hand-over is the
 * contract: if install.sh stops accepting --uninstall, or uninstall.sh stops
 * passing it, `bash ~/alabaster/scripts/uninstall.sh` breaks on printers
 * nobody can run a test on.
 */

const read = (script: string) => readFileSync(join(process.cwd(), 'scripts', script), 'utf8')

describe('installer scripts', () => {
  it('uninstall.sh hands over to install.sh --uninstall, locally and when fetched alone', () => {
    const uninstall = read('uninstall.sh')
    expect(uninstall).toMatch(/exec bash "\$\{here\}\/install\.sh" --uninstall "\$@"/)
    expect(uninstall).toMatch(
      /raw\.githubusercontent\.com\/Hannott\/Alabaster\/main\/scripts\/install\.sh.*--uninstall "\$@"/,
    )
  })

  it('install.sh accepts --uninstall and offers it in its help', () => {
    const install = read('install.sh')
    expect(install).toMatch(/--uninstall\) mode=uninstall; shift ;;/)
    expect(install).toMatch(/^ {2}--uninstall {13}\S/m)
  })
})

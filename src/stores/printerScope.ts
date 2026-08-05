/**
 * Per-printer tables in local storage were keyed by Moonraker endpoint before
 * printers had identities of their own. Keying on an address made one machine
 * into several — a hostname, an IP, and a tunnel are three keys for one printer —
 * so they key on the printer's id now.
 *
 * Both shapes have to be readable at once, and not only for upgrades: on a first
 * run the scope key is briefly the endpoint, because nothing is registered until
 * the first connection completes. So a read prefers the id and adopts an
 * endpoint-keyed entry when the id has none, and a write always stores under the
 * id and drops the endpoint entry it came from. Adoption therefore happens once,
 * and a second printer cannot inherit the first one's table.
 *
 * `scopeKeys` comes from `usePrintersStore().activeScopeKeys`, which is ordered
 * best-first for exactly this.
 */
export function readScoped(table: Record<string, unknown>, scopeKeys: readonly string[]): unknown {
  for (const key of scopeKeys) {
    if (key !== '' && key in table) return table[key]
  }
  return undefined
}

/**
 * The table to store, with the value under the preferred key and every other
 * candidate removed. Returns a new object; the caller serializes it.
 */
export function writeScoped(
  table: Record<string, unknown>,
  scopeKeys: readonly string[],
  value: unknown,
): Record<string, unknown> {
  const [preferred, ...superseded] = scopeKeys
  if (preferred === undefined || preferred === '') return table

  const next: Record<string, unknown> = { ...table, [preferred]: value }
  for (const key of superseded) {
    if (key !== '' && key !== preferred) delete next[key]
  }
  return next
}

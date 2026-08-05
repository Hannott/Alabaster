const HEAD_OPEN_TAG = /<head[^>]*>/i
const HTML_OPEN_TAG = /<html[^>]*>/i

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
}

/**
 * Points a preview document's relative asset references — a linked
 * stylesheet, a same-folder script, `<img src="chart.png">` — at the folder
 * Moonraker actually served the file from. A `srcdoc` iframe resolves
 * relative URLs against `about:srcdoc`, which holds nothing, so without this
 * every relative reference in an otherwise-working report would 404. Inserted
 * as early as the document allows, since `<base>` only affects references
 * that follow it.
 */
export function withBaseHref(html: string, baseHref: string): string {
  const tag = `<base href="${escapeAttribute(baseHref)}">`
  if (HEAD_OPEN_TAG.test(html)) return html.replace(HEAD_OPEN_TAG, (match) => `${match}${tag}`)
  if (HTML_OPEN_TAG.test(html)) return html.replace(HTML_OPEN_TAG, (match) => `${match}${tag}`)
  return `${tag}${html}`
}

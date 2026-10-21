import { describe, expect, it } from 'vitest'

import { createZipArchive } from '@/features/machine/zipArchive'

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer())
}

describe('createZipArchive', () => {
  it('writes a stored entry whose CRC matches the reference value', async () => {
    const data = new TextEncoder().encode('123456789')
    const zip = await bytesOf(
      createZipArchive([{ path: 'a/b.cfg', data, modified: 1_700_000_000 }]),
    )
    const view = new DataView(zip.buffer)

    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint32(14, true)).toBe(0xcbf43926)
    expect(view.getUint32(18, true)).toBe(9)
    expect(new TextDecoder().decode(zip.slice(30, 37))).toBe('a/b.cfg')
    expect(new TextDecoder().decode(zip.slice(37, 46))).toBe('123456789')
  })

  it('ends with a directory that counts and locates every entry', async () => {
    const encoder = new TextEncoder()
    const zip = await bytesOf(
      createZipArchive([
        { path: 'printer.cfg', data: encoder.encode('one'), modified: 1_700_000_000 },
        { path: 'macros.cfg', data: encoder.encode('three'), modified: 1_700_000_000 },
      ]),
    )
    const view = new DataView(zip.buffer)
    const end = zip.length - 22

    expect(view.getUint32(end, true)).toBe(0x06054b50)
    expect(view.getUint16(end + 10, true)).toBe(2)
    expect(view.getUint32(zip.length - 22 + 16, true)).toBe(30 + 11 + 3 + 30 + 10 + 5)
  })

  it('makes an empty archive that is only the end record', async () => {
    expect((await bytesOf(createZipArchive([]))).length).toBe(22)
  })
})

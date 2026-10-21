export interface ZipEntry {
  /** Forward-slash path inside the archive, without a leading slash. */
  path: string
  data: Uint8Array
  /** Modification time in seconds since the epoch, as Moonraker reports it. */
  modified: number
}

const MAX_ENTRIES = 0xffff
const MAX_BYTES = 0xffffffff
const UTF8_FLAG = 0x0800

const crcTable = new Uint32Array(256).map((_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }
  return value >>> 0
})

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** MS-DOS time and date words; the format cannot represent anything before 1980. */
function dosTimestamp(seconds: number): { time: number; date: number } {
  const moment = new Date(Math.max(seconds * 1000, Date.UTC(1980, 0, 1)))
  return {
    time: (moment.getHours() << 11) | (moment.getMinutes() << 5) | (moment.getSeconds() >> 1),
    date: ((moment.getFullYear() - 1980) << 9) | ((moment.getMonth() + 1) << 5) | moment.getDate(),
  }
}

/**
 * Packs files into a ZIP archive without compressing them.
 *
 * Stored rather than deflated because configuration is a few kilobytes of text
 * where compression saves nothing worth a dependency or a stream API the
 * printer's own browser may lack. It throws past the classic format's 65,535
 * entries or 4 GiB instead of writing the ZIP64 variant, which no configuration
 * folder reaches and a silently corrupt archive would be worse than an error.
 */
export function createZipArchive(entries: readonly ZipEntry[]): Blob {
  if (entries.length > MAX_ENTRIES) throw new RangeError('Too many files for a ZIP archive')
  const encoder = new TextEncoder()
  const parts: BlobPart[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.path)
    const crc = crc32(entry.data)
    const { time, date } = dosTimestamp(entry.modified)

    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true)
    local.setUint16(4, 20, true)
    local.setUint16(6, UTF8_FLAG, true)
    local.setUint16(10, time, true)
    local.setUint16(12, date, true)
    local.setUint32(14, crc, true)
    local.setUint32(18, entry.data.length, true)
    local.setUint32(22, entry.data.length, true)
    local.setUint16(26, name.length, true)

    const header = new DataView(new ArrayBuffer(46))
    header.setUint32(0, 0x02014b50, true)
    header.setUint16(4, 20, true)
    header.setUint16(6, 20, true)
    header.setUint16(8, UTF8_FLAG, true)
    header.setUint16(12, time, true)
    header.setUint16(14, date, true)
    header.setUint32(16, crc, true)
    header.setUint32(20, entry.data.length, true)
    header.setUint32(24, entry.data.length, true)
    header.setUint16(28, name.length, true)
    header.setUint32(42, offset, true)
    central.push(new Uint8Array(header.buffer), name)

    parts.push(new Uint8Array(local.buffer), name, entry.data as BlobPart)
    offset += 30 + name.length + entry.data.length
    if (offset > MAX_BYTES) throw new RangeError('Archive too large for a ZIP file')
  }

  const centralSize = central.reduce((total, part) => total + part.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true)
  end.setUint16(8, entries.length, true)
  end.setUint16(10, entries.length, true)
  end.setUint32(12, centralSize, true)
  end.setUint32(16, offset, true)

  return new Blob([...parts, ...(central as BlobPart[]), new Uint8Array(end.buffer)], {
    type: 'application/zip',
  })
}

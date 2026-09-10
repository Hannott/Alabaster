import { GcodeParser } from '@/features/gcode/parser'
import type { GcodeParserWorkerRequest, GcodeParserWorkerResponse } from '@/features/gcode/types'

interface WorkerScope {
  onmessage: ((event: MessageEvent<GcodeParserWorkerRequest>) => void) | null
  postMessage(message: GcodeParserWorkerResponse, transfer?: Transferable[]): void
}

const workerScope = self as unknown as WorkerScope
let parser: GcodeParser | null = null

workerScope.onmessage = (event) => {
  try {
    if (event.data.type === 'start') {
      parser = new GcodeParser(event.data.expectedTotalBytes, event.data.filamentDiameter)
      return
    }
    if (!parser) throw new Error('Parser has not been started')
    if (event.data.type === 'chunk') {
      parser.pushBytes(new Uint8Array(event.data.buffer))
      return
    }

    const summary = parser.finish()
    parser = null
    workerScope.postMessage({ type: 'parsed', summary }, [
      summary.segments.buffer,
      summary.sourceBytes.buffer,
      summary.layerHeights.buffer,
    ])
  } catch (error) {
    parser = null
    workerScope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown G-code parsing error',
    })
  }
}

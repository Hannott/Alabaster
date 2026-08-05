import { GcodeParser } from '@/features/gcode/parser'
import type {
  GcodeGeometryBatch,
  GcodeParserWorkerRequest,
  GcodeParserWorkerResponse,
} from '@/features/gcode/types'

interface WorkerScope {
  onmessage: ((event: MessageEvent<GcodeParserWorkerRequest>) => void) | null
  postMessage(message: GcodeParserWorkerResponse, transfer?: Transferable[]): void
}

const workerScope = self as unknown as WorkerScope
let parser: GcodeParser | null = null

function postBatch(batch: GcodeGeometryBatch): void {
  workerScope.postMessage({ type: 'batch', batch }, [
    batch.segments.buffer,
    batch.pathDetails.buffer,
    batch.caps.buffer,
  ])
}

workerScope.onmessage = (event) => {
  try {
    if (event.data.type === 'start') {
      parser = new GcodeParser(event.data.expectedTotalBytes, event.data.filamentDiameter)
      return
    }
    if (!parser) throw new Error('Parser has not been started')
    if (event.data.type === 'chunk') {
      parser.pushBytes(new Uint8Array(event.data.buffer))
      let batch = parser.drainBatch()
      while (batch) {
        postBatch(batch)
        batch = parser.drainBatch()
      }
      return
    }

    const { batch, summary } = parser.finishStream()
    parser = null
    if (batch) postBatch(batch)
    workerScope.postMessage({ type: 'parsed', summary }, [
      summary.segments.buffer,
      summary.sourceBytes.buffer,
      summary.layerHeights.buffer,
      ...Object.values(summary.tiers).flatMap((tier) => [
        tier.segments.buffer,
        tier.pathDetails.buffer,
      ]),
    ])
  } catch (error) {
    parser = null
    workerScope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown G-code parsing error',
    })
  }
}

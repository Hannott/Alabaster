import type { JsonRpcErrorPayload } from '@/services/moonraker/types'

export class MoonrakerConnectionError extends Error {
  constructor(message = 'Moonraker WebSocket connection failed') {
    super(message)
    this.name = 'MoonrakerConnectionError'
  }
}

export class MoonrakerDisconnectedError extends Error {
  constructor(message = 'Moonraker WebSocket is not connected') {
    super(message)
    this.name = 'MoonrakerDisconnectedError'
  }
}

export class MoonrakerRequestTimeoutError extends Error {
  readonly method: string
  readonly timeoutMs: number

  constructor(method: string, timeoutMs: number) {
    super(`Moonraker request '${method}' timed out after ${timeoutMs}ms`)
    this.name = 'MoonrakerRequestTimeoutError'
    this.method = method
    this.timeoutMs = timeoutMs
  }
}

export class MoonrakerRpcError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(payload: JsonRpcErrorPayload) {
    super(payload.message)
    this.name = 'MoonrakerRpcError'
    this.code = payload.code
    if ('data' in payload) this.data = payload.data
  }
}

export class MoonrakerProtocolError extends Error {
  readonly payload?: unknown

  constructor(message: string, payload?: unknown) {
    super(message)
    this.name = 'MoonrakerProtocolError'
    if (payload !== undefined) this.payload = payload
  }
}

export class MoonrakerEndpointError extends Error {
  constructor(message = 'The Moonraker endpoint is invalid') {
    super(message)
    this.name = 'MoonrakerEndpointError'
  }
}

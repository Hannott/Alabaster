import type { WebSocketLike } from '@/services/moonraker'

export class MockWebSocket {
  readyState: number = WebSocket.CONNECTING
  onopen: WebSocket['onopen'] = null
  onmessage: WebSocket['onmessage'] = null
  onerror: WebSocket['onerror'] = null
  onclose: WebSocket['onclose'] = null
  readonly sent: string[] = []
  readonly url: string

  constructor(url: string) {
    this.url = url
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
    if (typeof data !== 'string') throw new TypeError('Mock only accepts text frames')
    this.sent.push(data)
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === WebSocket.CLOSED) return
    this.readyState = WebSocket.CLOSED
    this.onclose?.call(
      this as unknown as WebSocket,
      new CloseEvent('close', { code, reason, wasClean: code === 1000 }),
    )
  }

  open(): void {
    this.readyState = WebSocket.OPEN
    this.onopen?.call(this as unknown as WebSocket, new Event('open'))
  }

  receive(payload: unknown): void {
    this.onmessage?.call(
      this as unknown as WebSocket,
      new MessageEvent('message', { data: JSON.stringify(payload) }),
    )
  }

  fail(): void {
    this.onerror?.call(this as unknown as WebSocket, new Event('error'))
  }

  closeFromServer(code = 1006, reason = ''): void {
    this.readyState = WebSocket.CLOSED
    this.onclose?.call(
      this as unknown as WebSocket,
      new CloseEvent('close', { code, reason, wasClean: false }),
    )
  }

  asWebSocketLike(): WebSocketLike {
    return this as WebSocketLike
  }
}

export function createMockSocketFactory(): {
  sockets: MockWebSocket[]
  factory: (url: string) => WebSocketLike
} {
  const sockets: MockWebSocket[] = []

  return {
    sockets,
    factory: (url) => {
      const socket = new MockWebSocket(url)
      sockets.push(socket)
      return socket.asWebSocketLike()
    },
  }
}

export function sentRequest(
  socket: MockWebSocket,
  method: string,
): { id: number; method: string; params?: Record<string, unknown> } {
  const requests = socket.sent.map(
    (message) =>
      JSON.parse(message) as { id: number; method: string; params?: Record<string, unknown> },
  )
  const request = requests.findLast((candidate) => candidate.method === method)
  if (!request) throw new Error(`No request for ${method}`)
  return request
}

export async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

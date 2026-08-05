import {
  MoonrakerConnectionError,
  MoonrakerDisconnectedError,
  MoonrakerProtocolError,
  MoonrakerRequestTimeoutError,
  MoonrakerRpcError,
} from '@/services/moonraker/errors'
import type {
  ErrorHandler,
  JsonRpcErrorPayload,
  JsonRpcNotification,
  JsonRpcParams,
  MoonrakerCallOptions,
  NotificationHandler,
  SocketCloseEventLike,
  TimerScheduler,
  WebSocketFactory,
  WebSocketLike,
} from '@/services/moonraker/types'
import { isRecord } from '@/utils/records'

const SOCKET_OPEN = 1
const NORMAL_CLOSE = 1000

interface PendingRequest {
  method: string
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  /** `null` for a request that deliberately has no local deadline. */
  timer: ReturnType<typeof setTimeout> | null
}

const browserScheduler: TimerScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (timer) => clearTimeout(timer),
}

function createBrowserSocket(url: string): WebSocketLike {
  return new WebSocket(url)
}

function isRpcErrorPayload(value: unknown): value is JsonRpcErrorPayload {
  return isRecord(value) && typeof value.code === 'number' && typeof value.message === 'string'
}

export interface JsonRpcTransportOptions {
  socketFactory?: WebSocketFactory
  requestTimeoutMs?: number
  scheduler?: TimerScheduler
}

export class JsonRpcTransport {
  private readonly socketFactory: WebSocketFactory
  private readonly requestTimeoutMs: number
  private readonly scheduler: TimerScheduler
  private readonly closeHandlers = new Set<(event: SocketCloseEventLike) => void>()
  private readonly notificationHandlers = new Map<string, Set<NotificationHandler>>()
  private readonly allNotificationHandlers = new Set<NotificationHandler>()
  private readonly protocolErrorHandlers = new Set<ErrorHandler>()
  private readonly pendingRequests = new Map<number, PendingRequest>()
  private socket: WebSocketLike | null = null
  private generation = 0
  private nextRequestId = 1

  constructor(options: JsonRpcTransportOptions = {}) {
    this.socketFactory = options.socketFactory ?? createBrowserSocket
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000
    this.scheduler = options.scheduler ?? browserScheduler
  }

  get isOpen(): boolean {
    return this.socket?.readyState === SOCKET_OPEN
  }

  async connect(url: string): Promise<void> {
    this.disconnect()
    const generation = ++this.generation

    let socket: WebSocketLike
    try {
      socket = this.socketFactory(url)
    } catch (error) {
      throw error instanceof Error ? error : new MoonrakerConnectionError()
    }

    this.socket = socket

    return new Promise<void>((resolve, reject) => {
      let opened = false
      let settled = false

      const rejectConnection = (error: Error): void => {
        if (settled) return
        settled = true
        reject(error)
      }

      socket.onopen = () => {
        if (!this.isCurrent(socket, generation)) return
        opened = true
        settled = true
        resolve()
      }

      socket.onmessage = (event) => {
        if (!this.isCurrent(socket, generation)) return
        this.handleMessage(event.data)
      }

      socket.onerror = () => {
        if (!this.isCurrent(socket, generation)) return
        rejectConnection(new MoonrakerConnectionError())
        socket.close()
      }

      socket.onclose = (event) => {
        if (!this.isCurrent(socket, generation)) return
        this.socket = null
        this.rejectPendingRequests(new MoonrakerDisconnectedError())
        if (!opened) rejectConnection(new MoonrakerConnectionError())
        this.emit(this.closeHandlers, event)
      }
    })
  }

  disconnect(): void {
    const socket = this.socket
    if (!socket) {
      this.rejectPendingRequests(new MoonrakerDisconnectedError())
      return
    }

    this.socket = null
    this.generation += 1
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    this.rejectPendingRequests(new MoonrakerDisconnectedError('Moonraker connection was closed'))
    socket.close(NORMAL_CLOSE, 'Client disconnect')
  }

  call<Result>(
    method: string,
    params?: JsonRpcParams,
    options: MoonrakerCallOptions = {},
  ): Promise<Result> {
    const socket = this.socket
    if (!socket || socket.readyState !== SOCKET_OPEN) {
      return Promise.reject(new MoonrakerDisconnectedError())
    }

    const id = this.nextRequestId
    this.nextRequestId += 1
    const timeoutMs = options.timeoutMs === undefined ? this.requestTimeoutMs : options.timeoutMs

    return new Promise<Result>((resolve, reject) => {
      // A caller that opts out of the deadline still gets rejected when the
      // socket closes, so an abandoned request never leaks.
      const timer =
        timeoutMs === null
          ? null
          : this.scheduler.setTimeout(() => {
              this.pendingRequests.delete(id)
              reject(new MoonrakerRequestTimeoutError(method, timeoutMs))
            }, timeoutMs)

      this.pendingRequests.set(id, {
        method,
        resolve: (value) => resolve(value as Result),
        reject,
        timer,
      })

      const request: Record<string, unknown> = { jsonrpc: '2.0', method, id }
      if (params !== undefined) request.params = params

      try {
        socket.send(JSON.stringify(request))
      } catch (error) {
        this.removePendingRequest(id)
        reject(error instanceof Error ? error : new MoonrakerConnectionError())
      }
    })
  }

  onClose(handler: (event: SocketCloseEventLike) => void): () => void {
    this.closeHandlers.add(handler)
    return () => this.closeHandlers.delete(handler)
  }

  onNotification(method: string, handler: NotificationHandler): () => void {
    const handlers = this.notificationHandlers.get(method) ?? new Set<NotificationHandler>()
    handlers.add(handler)
    this.notificationHandlers.set(method, handlers)

    return () => {
      handlers.delete(handler)
      if (handlers.size === 0) this.notificationHandlers.delete(method)
    }
  }

  onAnyNotification(handler: NotificationHandler): () => void {
    this.allNotificationHandlers.add(handler)
    return () => this.allNotificationHandlers.delete(handler)
  }

  onProtocolError(handler: ErrorHandler): () => void {
    this.protocolErrorHandlers.add(handler)
    return () => this.protocolErrorHandlers.delete(handler)
  }

  private isCurrent(socket: WebSocketLike, generation: number): boolean {
    return this.socket === socket && this.generation === generation
  }

  private handleMessage(rawData: unknown): void {
    if (typeof rawData !== 'string') {
      this.reportProtocolError(
        new MoonrakerProtocolError('Expected a text WebSocket frame', rawData),
      )
      return
    }

    let payload: unknown
    try {
      payload = JSON.parse(rawData)
    } catch {
      this.reportProtocolError(new MoonrakerProtocolError('Received invalid JSON', rawData))
      return
    }

    if (Array.isArray(payload)) {
      for (const message of payload) this.handlePayload(message)
      return
    }

    this.handlePayload(payload)
  }

  private handlePayload(payload: unknown): void {
    if (!isRecord(payload) || payload.jsonrpc !== '2.0') {
      this.reportProtocolError(
        new MoonrakerProtocolError('Received an invalid JSON-RPC payload', payload),
      )
      return
    }

    if (typeof payload.method === 'string' && !('id' in payload)) {
      if ('params' in payload && !Array.isArray(payload.params)) {
        this.reportProtocolError(
          new MoonrakerProtocolError('Moonraker notification params must be an array', payload),
        )
        return
      }

      const notification: JsonRpcNotification = {
        jsonrpc: '2.0',
        method: payload.method,
        params: (payload.params as readonly unknown[] | undefined) ?? [],
      }
      this.emit(this.notificationHandlers.get(notification.method), notification)
      this.emit(this.allNotificationHandlers, notification)
      return
    }

    if (typeof payload.id !== 'number') {
      this.reportProtocolError(
        new MoonrakerProtocolError('Response has no numeric request id', payload),
      )
      return
    }

    const pending = this.removePendingRequest(payload.id)
    if (!pending) return

    if ('error' in payload) {
      if (isRpcErrorPayload(payload.error)) pending.reject(new MoonrakerRpcError(payload.error))
      else pending.reject(new MoonrakerProtocolError('Response contains an invalid error', payload))
      return
    }

    if (!('result' in payload)) {
      pending.reject(
        new MoonrakerProtocolError('Response contains neither result nor error', payload),
      )
      return
    }

    pending.resolve(payload.result)
  }

  private removePendingRequest(id: number): PendingRequest | undefined {
    const pending = this.pendingRequests.get(id)
    if (!pending) return undefined

    if (pending.timer !== null) this.scheduler.clearTimeout(pending.timer)
    this.pendingRequests.delete(id)
    return pending
  }

  private rejectPendingRequests(error: Error): void {
    for (const id of this.pendingRequests.keys()) {
      const pending = this.removePendingRequest(id)
      pending?.reject(error)
    }
  }

  private reportProtocolError(error: Error): void {
    this.emit(this.protocolErrorHandlers, error)
  }

  private emit<Value>(handlers: Set<(value: Value) => void> | undefined, value: Value): void {
    if (!handlers) return

    for (const handler of handlers) {
      try {
        handler(value)
      } catch (error) {
        if (handlers !== this.protocolErrorHandlers) {
          this.reportProtocolError(
            error instanceof Error ? error : new MoonrakerProtocolError('Event handler failed'),
          )
        }
      }
    }
  }
}

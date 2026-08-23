/// <reference types="vite/client" />

declare const __APP_VERSION__: string

/**
 * `jmuxer` ships no type declarations of its own, so the surface Alabaster
 * actually uses is declared here rather than the module being cast to `any` at
 * the one call site. Only `webrtc-janus`'s sibling service — `jmuxer-stream` in
 * `src/components/camera/streamers/JmuxerStreamer.vue` — consumes it, and it
 * uses four of the library's options and two of its methods; declaring exactly
 * those means a typo in one of them is still a build error.
 */
declare module 'jmuxer' {
  interface JMuxerOptions {
    node: HTMLVideoElement | string
    mode?: 'video' | 'audio' | 'both'
    /** Milliseconds to buffer before flushing; 0 for the lowest latency. */
    flushingTime?: number
    /** The rate frames are stamped at, since a raw H.264 stream carries none. */
    fps?: number
    debug?: boolean
    onReady?: () => void
    onError?: (error: unknown) => void
  }

  export default class JMuxer {
    constructor(options: JMuxerOptions)
    feed(data: { video?: Uint8Array; audio?: Uint8Array; duration?: number }): void
    destroy(): void
  }
}

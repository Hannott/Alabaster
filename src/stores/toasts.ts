import { defineStore } from 'pinia'
import { reactive } from 'vue'

import { i18n } from '@/i18n'

export interface ToastEntry {
  id: string
  message: string
  durationMs: number
}

const defaultDurationMs = 5000

function nextId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message.trim() : ''
  return message === '' ? i18n.global.t('toast.commandFailedFallback') : message
}

/**
 * The one place a failed command becomes something the user sees. Every
 * caller used to render its own "the command could not be completed, check
 * the printer" paragraph plus a second sentence quoting Klipper's reply,
 * permanently occupying card space until the next attempt overwrote it. A
 * toast says only what actually went wrong and clears itself, so a transient
 * refusal reads as transient instead of becoming part of the card's layout.
 */
export const useToastsStore = defineStore('toasts', () => {
  const entries = reactive<ToastEntry[]>([])

  function push(message: string, durationMs = defaultDurationMs): void {
    entries.push({ id: nextId(), message, durationMs })
  }

  /** `error` is whatever a rejected command threw — always an `Error` from `services/moonraker`, but never assumed. */
  function pushError(error: unknown): void {
    push(i18n.global.t('toast.error', { message: errorMessage(error) }))
  }

  function dismiss(id: string): void {
    const index = entries.findIndex((entry) => entry.id === id)
    if (index !== -1) entries.splice(index, 1)
  }

  return { entries, push, pushError, dismiss }
})

import { readonly, ref } from 'vue'

/**
 * The console's own text weight, independent of `useTextWeight`. Console
 * text carries no weight of its own today — `.gcode-console` and the prompt
 * render at the browser's normal weight — so this is a genuine two-stop
 * choice rather than a reduction from a heavier default.
 */
export type ConsoleWeightMode = 'regular' | 'bold'

const consoleWeightStorageKey = 'alabaster.consoleWeight'

export function isConsoleWeightMode(value: string): value is ConsoleWeightMode {
  return value === 'regular' || value === 'bold'
}

function getInitialConsoleWeightMode(): ConsoleWeightMode {
  const saved = localStorage.getItem(consoleWeightStorageKey)
  return saved !== null && isConsoleWeightMode(saved) ? saved : 'regular'
}

const mode = ref<ConsoleWeightMode>(getInitialConsoleWeightMode())

function applyConsoleWeight(next: ConsoleWeightMode): void {
  document.documentElement.dataset.consoleWeight = next
}

function setConsoleWeightMode(next: ConsoleWeightMode): void {
  mode.value = next
  localStorage.setItem(consoleWeightStorageKey, next)
  applyConsoleWeight(next)
}

applyConsoleWeight(mode.value)

export function useConsoleWeight() {
  return {
    mode: readonly(mode),
    setConsoleWeightMode,
  }
}

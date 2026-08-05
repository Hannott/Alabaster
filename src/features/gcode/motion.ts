const springFrequency = 18
const maximumStepSeconds = 1 / 30
const staleSampleMilliseconds = 1_500
const teleportDistance = 100

function finitePosition(
  position: readonly number[],
): position is readonly [number, number, number] {
  return position.length >= 3 && position.slice(0, 3).every(Number.isFinite)
}

export class SmoothToolheadPosition {
  private current: [number, number, number] = [0, 0, 0]
  private target: [number, number, number] = [0, 0, 0]
  private velocity: [number, number, number] = [0, 0, 0]
  private initialized = false
  private lastSampleAt = 0
  private lastFrameAt = 0

  setTarget(position: readonly number[], timestamp: number): void {
    if (!finitePosition(position)) return
    const next: [number, number, number] = [position[0], position[1], position[2]]
    const distance = Math.hypot(
      next[0] - this.current[0],
      next[1] - this.current[1],
      next[2] - this.current[2],
    )
    if (
      !this.initialized ||
      timestamp - this.lastSampleAt > staleSampleMilliseconds ||
      distance > teleportDistance
    ) {
      this.current = [...next]
      this.velocity = [0, 0, 0]
      this.initialized = true
      this.lastFrameAt = timestamp
    }
    this.target = next
    this.lastSampleAt = timestamp
  }

  step(
    timestamp: number,
    reducedMotion = false,
  ): { position: [number, number, number]; moving: boolean } {
    if (!this.initialized) return { position: [...this.current], moving: false }
    if (reducedMotion) {
      this.current = [...this.target]
      this.velocity = [0, 0, 0]
      this.lastFrameAt = timestamp
      return { position: [...this.current], moving: false }
    }

    const deltaSeconds = Math.min(
      maximumStepSeconds,
      Math.max(0, (timestamp - this.lastFrameAt) / 1000),
    )
    this.lastFrameAt = timestamp
    let moving = false
    const stiffness = springFrequency * springFrequency
    const damping = springFrequency * 2

    for (let axis = 0; axis < 3; axis += 1) {
      const displacement = (this.target[axis] ?? 0) - (this.current[axis] ?? 0)
      const acceleration = stiffness * displacement - damping * (this.velocity[axis] ?? 0)
      this.velocity[axis] = (this.velocity[axis] ?? 0) + acceleration * deltaSeconds
      this.current[axis] = (this.current[axis] ?? 0) + (this.velocity[axis] ?? 0) * deltaSeconds
      if (Math.abs(displacement) > 0.002 || Math.abs(this.velocity[axis] ?? 0) > 0.02) moving = true
    }

    if (!moving) {
      this.current = [...this.target]
      this.velocity = [0, 0, 0]
    }
    return { position: [...this.current], moving }
  }

  value(): [number, number, number] {
    return [...this.current]
  }
}

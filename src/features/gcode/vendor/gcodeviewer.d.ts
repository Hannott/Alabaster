/**
 * Hand-written typings for `@sindarius/gcodeviewer`, which ships JavaScript
 * with no declarations of its own.
 *
 * Deliberately partial. It declares only the members `libraryRenderer.ts`
 * actually calls, which is what makes the surface Alabaster depends on
 * reviewable in one file and gives a library upgrade a finite checklist.
 * Anything missing here is something the adapter has decided not to use rather
 * than something the library lacks — ADR 0011 keeps that list and the reasons.
 *
 * The Babylon.js objects the library hands back are described structurally
 * rather than imported from `@babylonjs/core`. Babylon is the library's own
 * transitive dependency, not ours, and a structural shape cannot break when
 * the resolved Babylon version moves under us.
 *
 * `tsconfig.app.json` maps the package name at this file, rather than relying
 * on an ambient `declare module` block. An ambient block resolves under
 * `--noEmit` and silently does not under `--build`, which is a difference
 * nobody should have to discover twice: the package ships a bare `.js` entry
 * with no `types` field, so the mapping is what makes the declaration
 * authoritative in every mode.
 */
declare module '@sindarius/gcodeviewer' {
  interface BabylonColor4 {
    r: number
    g: number
    b: number
    a: number
  }

  interface BabylonObservable<T> {
    add(callback: (value: T) => void): unknown
    removeCallback(callback: (value: T) => void): void
  }

  interface BabylonMatrix {
    /**
     * Row-major, in the order `Vector3.TransformCoordinates` reads: a point is
     * a row vector multiplied on the left. Projection in the adapter follows
     * that convention exactly.
     */
    m: Float32Array | readonly number[]
  }

  interface BabylonVector3 {
    x: number
    y: number
    z: number
  }

  interface ArcRotateCameraLike {
    /** Babylon's own signature: the first argument is ignored. */
    attachControl(ignored?: unknown, noPreventDefault?: boolean): void
    detachControl(): void
    alpha: number
    beta: number
    radius: number
    target: BabylonVector3
    lowerBetaLimit: number
    upperBetaLimit: number
    inertialAlphaOffset: number
    inertialBetaOffset: number
    inertialRadiusOffset: number
    inertialPanningX: number
    inertialPanningY: number
    panningSensibility: number
    /** Vertical field of view in radians; Babylon fixes the vertical one. */
    fov: number
    readonly globalPosition: BabylonVector3
    /** The camera's input plugins, by Babylon's short names. */
    inputs: {
      attached: {
        keyboard?: CameraInputLike
        mousewheel?: CameraInputLike & { wheelDeltaPercentage: number }
        pointers?: CameraInputLike & { pinchDeltaPercentage: number }
      }
    }
  }

  interface CameraInputLike {
    detachControl(): void
  }

  interface SceneLike {
    render(forceRender?: boolean): void
    dispose(): void
    attachControl(): void
    detachControl(): void
    /**
     * Babylon's per-frame hook. The library uses it, and only it, to render its
     * orientation cube's separate scene into a corner viewport — which is why
     * replacing it is how the cube is turned off.
     */
    afterRender: (() => void) | null
    getTransformMatrix(): BabylonMatrix
    activeCamera: ArcRotateCameraLike | null
    onBeforeRenderObservable: BabylonObservable<SceneLike>
    onAfterRenderObservable: BabylonObservable<SceneLike>
  }

  interface EngineCaps {
    /**
     * Babylon's asynchronous shader-compilation extension. Set to `undefined`
     * to force synchronous compilation — see the adapter for why that is not
     * optional here.
     */
    parallelShaderCompile?: unknown
  }

  interface EngineLike {
    resize(): void
    dispose(): void
    /** The tab index Babylon gives the canvas whenever it attaches its input. */
    canvasTabIndex: number
    getCaps(): EngineCaps
    setHardwareScalingLevel(level: number): void
    getHardwareScalingLevel(): number
    getRenderWidth(): number
    getRenderHeight(): number
  }

  /**
   * One entry of a slicer's own feature vocabulary. The adapter reads this to
   * colour the legend with the library's palette instead of guessing at it —
   * see ADR 0011 on why feature colour is the library's to own.
   */
  interface SlicerFeature {
    color: BabylonColor4
  }

  interface SlicerLike {
    featureList?: Record<string, SlicerFeature>
  }

  interface GcodeProcessorLike {
    /** Fractional, 0 to 1, called repeatedly while a file is parsed. */
    loadingProgressCallback: ((progress: number) => void) | null
    /** Set true to abandon an in-flight parse. */
    cancelLoad: boolean
    colorMode: number
    /**
     * How far past the drawn frontier geometry is revealed anyway, in bytes.
     * The adapter sets it to zero: ADR 0007's reveal rule is that nothing
     * ahead of the cursor is drawn, and the library's default of 500 would
     * show a few moves the printer has not made.
     */
    lookAheadLength: number
    /** Feed-rate colour range, in mm/min. */
    minColorRate: number
    maxColorRate: number
    /** False at the two cheapest tiers, which never build travel geometry. */
    renderTravels: boolean
    /** The detected slicer, available only after a file has been processed. */
    slicer: SlicerLike | null
    /** Byte offset of the drawn frontier; the one call live follow ends in. */
    updateFilePosition(filePosition: number): void
    /**
     * Stamps the processor's last-update time, which is what the library's
     * render loop checks before skipping a frame: the scene keeps rendering
     * for a second after it.
     */
    doUpdate(): void
    setLiveTracking(enabled: boolean): void
    setColorMode(mode: number): void
    updateColorRate(minimum: number, maximum: number): void
    updateMinFeedColor(hex: string): void
    updateMaxFeedColor(hex: string): void
    resetTools(): void
    addTool(hex: string, diameter: number): void
    useHighQualityExtrusion(enabled: boolean): void
    updateForceWireMode(enabled: boolean): void
    setVoxelMode(enabled: boolean): void
    useSpecularColor(enabled: boolean): void
    setAlpha(enabled: boolean): void
    forceRedraw(): void
  }

  interface BedLike {
    buildVolume: {
      x: { min: number; max: number }
      y: { min: number; max: number }
      z: { min: number; max: number }
    }
    setBedColor(hex: string): void
    setDelta(isDelta: boolean): void
    commitBedSize(): void
  }

  interface AxesLike {
    show(visible: boolean): void
  }

  export const RenderMode: { Block: 1; Line: 2; Point: 3; Max: 4; Voxel: 5 }
  export const ColorMode: { Color: 0; Feed: 1; Feature: 2 }

  export default class GCodeViewer {
    constructor(canvas: HTMLCanvasElement)

    readonly gcodeProcessor: GcodeProcessorLike
    readonly bed: BedLike
    readonly axes: AxesLike
    /** Populated by `init`; absent before it resolves. */
    scene: SceneLike
    engine: EngineLike
    orbitCamera: ArcRotateCameraLike
    fileSize: number
    renderQuality: number
    /** Milliseconds of scene stillness after which the render loop idles. */
    renderTimeout: number

    /** Resolves once the engine, scene, camera and bed exist. */
    init(useWebGPU?: boolean): Promise<void>
    processFile(fileContents: string): Promise<void>
    reload(): Promise<void>
    clearScene(clearFileData?: boolean): void
    resize(): void
    resetCamera(): void
    forceRender(): void
    toggleTravels(visible: boolean): void
    setZClipPlane(top: number, bottom: number): void
    setBackgroundColor(hex: string): void
    setProgressColor(hex: string): void
    updateRenderQuality(renderQuality: number): void
    setCameraInertia(enabled: boolean): void
    /** True when the previous parse in this browser never reached its end. */
    lastLoadFailed(): boolean
    clearLoadFlag(): void

    /*
     * The library's own toolhead cursor and the lazy builder behind it, which
     * the adapter replaces so the OBJ nozzle model is never loaded. Typed
     * loosely on purpose: these are internals nothing above the seam may
     * touch, present here only because containing them is the adapter's job.
     */
    buildtoolCursor: () => void
    toolCursor: unknown
    toolCursorMesh: { isVisible: boolean }
  }
}

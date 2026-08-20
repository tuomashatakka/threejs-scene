// lib/quality/signals.ts
// What the device says about itself, before anything has been drawn on it.
//
// Split out from whatever picks a budget from them, so the answer can be
// *shown*. A tier that turns out to be wrong for a device is indistinguishable
// from a tier that is right and still too heavy, unless you can read the signals
// it was picked from — and on a handset, a log line is the only place that can
// be read at all.
//
// None of these are a GPU. There is no way to ask a browser what GPU it has that
// is both reliable and not fingerprinting, so these are the proxies that
// correlate: a coarse pointer and a small viewport mean a phone, a dense display
// means a fill-rate problem whatever the chip, and cores to spare mean a machine
// that was plugged in when it was built.

/** The device facts a quality tier can be chosen from. All cheap to read. */
export interface QualitySignals {

  /** A touchscreen, or anything else without a hoverable pointer. */
  coarsePointer: boolean

  /** A viewport small enough to be a phone. */
  compactViewport: boolean

  /** `devicePixelRatio`. The first thing that sinks a fullscreen post chain. */
  pixelRatio: number

  /** Logical cores, or 4 when the browser will not say. */
  hardwareConcurrency: number

  /** A viewport wide enough to suggest a desktop. */
  wideViewport: boolean
}

export interface QualitySignalOptions {

  /**
   * The width, in css pixels, at or below which a viewport counts as compact.
   *
   * @defaultValue 1100 — and not 900. A phone turned on its side is 844 to 932
   * css pixels wide depending on the handset, so 900 cuts straight through the
   * middle of the range and hands the larger half of every phone in landscape to
   * the desktop budget.
   */
  compactWidth?: number

  /** The width at or above which a viewport counts as wide. @defaultValue 1280 */
  wideWidth?: number
}

/**
 * Read the signals off the current environment.
 *
 * Every probe is optional-chained and defaulted, so this is safe to call
 * server-side or in a test with no DOM — it simply reports a plain, wide,
 * mouse-driven machine.
 *
 * @param options - Viewport thresholds; see {@link QualitySignalOptions}.
 * @returns The {@link QualitySignals} for this device.
 */
export function readQualitySignals (options: QualitySignalOptions = {}): QualitySignals {
  const compactWidth = options.compactWidth ?? 1100
  const wideWidth    = options.wideWidth ?? 1280

  return {
    coarsePointer:       globalThis.matchMedia?.('(pointer: coarse)').matches ?? false,
    compactViewport:     globalThis.matchMedia?.(`(max-width: ${compactWidth}px)`).matches ?? false,
    pixelRatio:          globalThis.devicePixelRatio ?? 1,
    hardwareConcurrency: globalThis.navigator?.hardwareConcurrency ?? 4,
    wideViewport:        globalThis.matchMedia?.(`(min-width: ${wideWidth}px)`).matches ?? false,
  }
}

/**
 * The signals as one line, for the log a phone can actually show.
 *
 * Includes `deviceMemory` where the browser offers it — it is not in
 * {@link QualitySignals} because it is too unevenly implemented to choose a
 * budget from, and too useful to leave out of a crash report.
 *
 * @param signals - What {@link readQualitySignals} returned.
 * @returns A single `·`-separated line.
 */
export function describeQualitySignals (signals: QualitySignals): string {
  const memory = (globalThis.navigator as { deviceMemory?: number } | undefined)?.deviceMemory

  return [
    `coarse ${signals.coarsePointer}`,
    `compact ${signals.compactViewport}`,
    `wide ${signals.wideViewport}`,
    `dpr ${signals.pixelRatio}`,
    `cores ${signals.hardwareConcurrency}`,
    memory === undefined ? 'ram ?' : `ram ${memory}gb`,
    `${globalThis.innerWidth}×${globalThis.innerHeight}css`,
  ].join(' · ')
}

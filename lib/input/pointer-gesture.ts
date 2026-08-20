// lib/input/pointer-gesture.ts
// Unified pointer gesture layer. Drag, pinch, wheel, tap — works identically
// on mouse, touch, pen, stylus. Always use this instead of mouse*/touch*
// events.

/**
 * Unified pointer gesture callbacks. The same handlers fire for mouse, touch,
 * and pen — always prefer this over discrete mouse/touch listeners.
 */
export interface PointerGestureCallbacks {

  /**
   * The first pointer went down. Fires before any drag, and once per gesture
   * however many pointers join it.
   *
   * This is where a consumer latches whatever the gesture means: which mouse
   * button or modifier was held, focusing the element so it can take key
   * events, or leaving whatever was driving the view automatically. A press is
   * an act of intent even when it never becomes a drag — deciding on the first
   * *move* instead makes press-and-hold do nothing, and re-reading modifiers
   * per move makes releasing shift mid-drag change the verb underneath the
   * reader's hand.
   */
  onPressStart?: (x: number, y: number, event: PointerEvent) => void

  /** The last pointer lifted or was cancelled. The counterpart to {@link PointerGestureCallbacks.onPressStart}. */
  onPressEnd?: (event: PointerEvent) => void

  onDrag?: (dx: number, dy: number, event: PointerEvent) => void

  /**
   * Two pointers moved. `deltaScale` is the distance ratio to the previous move
   * (>1 zoom in), `centerX`/`centerY` the pinch centre, and `panX`/`panY` how
   * far that centre travelled since the last move — a two-finger pinch is
   * almost always a two-finger *drag* as well, and rederiving that from the
   * absolute centre is a thing every caller would otherwise write itself.
   */
  onPinch?: (deltaScale: number, centerX: number, centerY: number, panX: number, panY: number) => void

  onTap?:   (x: number, y: number, event: PointerEvent) => void
  onWheel?: (delta: number, event: WheelEvent) => void

  /**
   * Every pointer move over the element, pressed or not, in client
   * coordinates — hover parallax, cursor-follow lights, tooltips. Fires
   * alongside `onDrag` while a drag is in progress.
   */
  onHover?: (x: number, y: number, event: PointerEvent) => void

  /**
   * The pointer left the element. Pair with `onHover` to ease hover-driven
   * state back to neutral instead of freezing it at the last position.
   */
  onLeave?: (event: PointerEvent) => void
}

/** Tap-detection tuning for {@link attachPointerGesture}. */
export interface PointerGestureOptions {

  /**
   * Max press duration in milliseconds still counted as a tap.
   * @defaultValue 250
   */
  tapThresholdMs?: number

  /**
   * Max pointer travel in CSS pixels still counted as a tap.
   * @defaultValue 8
   */
  tapMovePx?: number
}

interface TrackedPointer {
  x:     number
  y:     number
  lastX: number
  lastY: number
}

/**
 * Attach unified drag/pinch/tap/wheel gesture handling to an element.
 *
 * Single-pointer moves fire `onDrag` with per-move deltas in CSS pixels;
 * two-pointer moves fire `onPinch` with the distance ratio to the previous
 * move (>1 zoom in), the pinch center, and how far that center travelled; a
 * press released within the tap thresholds fires `onTap`; `onWheel` receives
 * the raw `deltaY` and calls `preventDefault()` on the event. `onPressStart`
 * and `onPressEnd` bracket the whole gesture, `onHover` fires on every move
 * regardless of button state, and `onLeave` when the pointer exits the element.
 *
 * @param el - Element to listen on, typically the render canvas. Its
 * `touch-action` style is set to `none` to disable native panning/zooming.
 * @param callbacks - Gesture handlers; all optional.
 * @param options - Tap detection thresholds; see {@link PointerGestureOptions}.
 * @returns Detach function removing all listeners. The `touch-action` override
 * is not restored.
 */
export function attachPointerGesture (
  el: HTMLElement,
  callbacks: PointerGestureCallbacks,
  { tapThresholdMs = 250, tapMovePx = 8 }: PointerGestureOptions = {},
): () => void {
  const pointers = new Map<number, TrackedPointer>()
  let lastPinchDist = 0
  let lastCenterX   = 0
  let lastCenterY   = 0
  let downAt        = 0
  let downX         = 0
  let downY         = 0

  /**
   * Whether this gesture was ever more than one pointer.
   *
   * Without it, lifting two fingers in quick succession fires a tap nobody
   * made: the tap check runs when the *last* pointer leaves, but the press it
   * measures against was recorded by the *first*. So a pinch that ends near
   * where it began, quickly enough, reads as a tap.
   */
  let multiTouch = false

  // critical: disable native gesture handling on the canvas
  el.style.touchAction = 'none'

  const onSecondaryDown = (e: PointerEvent): void => {
    e.preventDefault()
  }

  const onDown = (e: PointerEvent): void => {
    el.setPointerCapture(e.pointerId)
    pointers.set(e.pointerId, {
      x:     e.clientX,
      y:     e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
    })
    if (pointers.size === 1) {
      downAt = performance.now()
      downX = e.clientX
      downY = e.clientY
      callbacks.onPressStart?.(e.clientX, e.clientY, e)
    }
    else if (pointers.size === 2) {
      const [ a, b ] = [ ...pointers.values() ]
      if (a && b) {
        lastPinchDist = Math.hypot(a.x - b.x, a.y - b.y)
        lastCenterX = (a.x + b.x) / 2
        lastCenterY = (a.y + b.y) / 2
      }
    }

    multiTouch ||= pointers.size > 1
  }

  const onMove = (e: PointerEvent): void => {
    // hover fires for untracked pointers too — that is the whole point of it
    callbacks.onHover?.(e.clientX, e.clientY, e)

    const p = pointers.get(e.pointerId)
    if (!p)
      return
    p.lastX = p.x; p.lastY = p.y
    p.x                    = e.clientX; p.y = e.clientY

    if (pointers.size === 1 && callbacks.onDrag)
      callbacks.onDrag(p.x - p.lastX, p.y - p.lastY, e)
    else if (pointers.size === 2 && callbacks.onPinch) {
      const [ a, b ] = [ ...pointers.values() ]
      if (!a || !b)
        return

      const dist    = Math.hypot(a.x - b.x, a.y - b.y)
      const centerX = (a.x + b.x) / 2
      const centerY = (a.y + b.y) / 2

      if (lastPinchDist > 0)
        callbacks.onPinch(
          dist / lastPinchDist,
          centerX,
          centerY,
          centerX - lastCenterX,
          centerY - lastCenterY,
        )

      lastPinchDist = dist
      lastCenterX = centerX
      lastCenterY = centerY
    }
  }

  const onUp = (e: PointerEvent): void => {
    const p = pointers.get(e.pointerId)
    pointers.delete(e.pointerId)
    if (pointers.size < 2)
      lastPinchDist = 0

    if (p && pointers.size === 0) {
      const dt    = performance.now() - downAt
      const moved = Math.hypot(p.x - downX, p.y - downY)

      if (!multiTouch && dt < tapThresholdMs && moved < tapMovePx)
        callbacks.onTap?.(p.x, p.y, e)

      multiTouch = false
      callbacks.onPressEnd?.(e)
    }
  }

  const onLeave = (e: PointerEvent): void => {
    callbacks.onLeave?.(e)
  }

  const onWheel = (e: WheelEvent): void => {
    if (callbacks.onWheel) {
      e.preventDefault()
      callbacks.onWheel(e.deltaY, e)
    }
  }

  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onUp)
  // A capture lost to the browser — a system gesture, a dragged-away finger —
  // ends the pointer as surely as lifting it, and without this the gesture
  // stays open forever with a pointer that will never move again.
  el.addEventListener('lostpointercapture', onUp)
  el.addEventListener('pointerleave', onLeave)
  el.addEventListener('contextmenu', onSecondaryDown)
  el.addEventListener('wheel', onWheel, { passive: false })

  return () => {
    el.removeEventListener('pointerdown', onDown)
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onUp)
    el.removeEventListener('lostpointercapture', onUp)
    el.removeEventListener('pointerleave', onLeave)
    el.removeEventListener('contextmenu', onSecondaryDown)
    el.removeEventListener('wheel', onWheel)
  }
}

// perf: cheap. allocates one Map for active pointers; no per-frame work.

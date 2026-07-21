// lib/render/resize.ts
// Keeps the renderer and camera in sync with the canvas parent's size via a
// ResizeObserver, then fans the new size out to app-level handlers (module
// resize hooks, ortho frustums, composers).

import type * as THREE from 'three'


/** Callback invoked after a resize with the new width and height in CSS pixels. */
export type ResizeHandler = (width: number, height: number) => void

/**
 * Observe the canvas parent's size and keep the renderer and camera in sync.
 * On each resize the renderer is resized and, for perspective cameras, the
 * aspect ratio and projection matrix are updated; `onResize` then runs for
 * app-level work.
 *
 * @returns Detach function that disconnects the observer. In environments
 * without `ResizeObserver` (SSR, headless tests) this is a no-op.
 */
export function attachResizeObserver (
  renderer: THREE.WebGLRenderer,
  camera: THREE.Camera,
  canvas: HTMLCanvasElement,
  onResize?: ResizeHandler,
): () => void {
  if (typeof ResizeObserver === 'undefined')
    return () => {}

  const ro = new ResizeObserver(entries => {
    const entry = entries[0]
    if (!entry)
      return

    const { width, height } = entry.contentRect
    renderer.setSize(width, height, false)
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const perspective  = camera as THREE.PerspectiveCamera
      perspective.aspect = width / height
      perspective.updateProjectionMatrix()
    }
    onResize?.(width, height)
  })
  ro.observe(canvas.parentElement ?? document.body)
  return () => ro.disconnect()
}

// perf: cheap. one observer per app; fires only on actual size changes.

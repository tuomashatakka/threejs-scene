// site/collapse.ts
// One collapse control, shared by the starter gallery's source pane and the
// demo's effect panel. Both are the same problem — a side panel the page can
// live without — so both get the same contract:
//
//   • the BUTTON owns `aria-expanded`, because the button is what a screen
//     reader user operates; the panel gets `aria-controls` pointing at it
//   • the state lives in a `data-collapsed` attribute on the panel, so the
//     animation is entirely CSS and this file never touches a style property
//   • the choice is remembered per page, because re-hiding a panel on every
//     reload is the kind of thing that makes a demo annoying to use
//
// The panel is never `display:none` or `hidden` while collapsed — the CSS
// shrinks it instead. That keeps the toggle itself on screen, which is the
// whole difference between "collapsible" and "gone".

interface CollapseOptions {

  /** The element that shrinks. Carries `data-collapsed` when closed. */
  panel: HTMLElement

  /** The control. Gets `aria-expanded` + label upkeep. */
  button: HTMLButtonElement

  /** localStorage key for remembering the choice. */
  storageKey: string

  /** Accessible name when open / closed. */
  labels: { open: string, closed: string }
}

/**
 * Wire a panel to a toggle.
 *
 * @returns A detach function that removes the listener — call it from the
 * page's teardown so HMR reloads do not stack handlers.
 */
export function attachCollapse ({ panel, button, storageKey, labels }: CollapseOptions): () => void {
  // A missing/blocked localStorage (private mode, embedded frame) must not take
  // the page down with it — the panel simply forgets between reloads.
  const remember = (collapsed: boolean): void => {
    try {
      localStorage.setItem(storageKey, collapsed ? '1' : '0')
    }
    catch { /* storage unavailable — the toggle still works for this session */ }
  }

  const recall = (): boolean => {
    try {
      return localStorage.getItem(storageKey) === '1'
    }
    catch {
      return false
    }
  }

  function apply (collapsed: boolean): void {
    panel.toggleAttribute('data-collapsed', collapsed)
    button.setAttribute('aria-expanded', String(!collapsed))
    button.title = collapsed ? labels.closed : labels.open
    button.setAttribute('aria-label', button.title)
  }

  const onClick = (): void => {
    const collapsed = !panel.hasAttribute('data-collapsed')
    apply(collapsed)
    remember(collapsed)
  }

  if (panel.id)
    button.setAttribute('aria-controls', panel.id)

  // Restore before the first paint so a remembered-collapsed panel does not
  // animate shut in front of the user on every load.
  panel.setAttribute('data-collapse-ready', '')
  apply(recall())
  requestAnimationFrame(() => panel.removeAttribute('data-collapse-ready'))

  button.addEventListener('click', onClick)
  return () => button.removeEventListener('click', onClick)
}

// Pure keyboard-event predicates shared by the document-level keydown
// handlers in SessionListPage and SessionDetailPage. No DOM, no react.

/**
 * True when a modifier key that browsers/OSes reserve for their own
 * shortcuts (Cmd/Ctrl+F find-in-page, Cmd+P print, Alt-based menu access,
 * etc.) is held. Single-letter app shortcuts (`j`, `k`, `f`, ...) must not
 * intercept these — callers should bail out before acting on the key.
 * Shift is deliberately excluded: `G` (shift+g) is a real app shortcut.
 */
export function isModifierKeyEvent(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return e.metaKey || e.ctrlKey || e.altKey
}

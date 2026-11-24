/**
 * Split view (two workspace tabs side by side). Pure rules, applied by the
 * store after every change, so every existing way of switching tabs
 * (tab strip, Ctrl+Tab, palette, opening a table) keeps working in split mode:
 *
 * - Activating a tab already in the split just moves focus between panes.
 * - Activating any other tab replaces the pane that had focus, the way an
 *   editor group does, so the other pane stays put.
 * - If either tab closes, or both panes would show the same tab, the split ends.
 */

/** Tab ids shown in the left and right panes. */
export interface SplitPanes {
  left: string
  right: string
}

/** Returns the split to keep after a state change from `prevActive` to `nextActive`. */
export function normalizeSplit(
  split: SplitPanes | null,
  prevActive: string | null,
  nextActive: string | null,
  tabIds: readonly string[]
): SplitPanes | null {
  if (!split) return null
  if (!tabIds.includes(split.left) || !tabIds.includes(split.right)) return null
  if (!nextActive || nextActive === split.left || nextActive === split.right) return split
  const next = prevActive === split.right ? { left: split.left, right: nextActive } : { left: nextActive, right: split.right }
  return next.left === next.right ? null : next
}

/** Which pane a tab is in, or null if it isn't visible in the split. */
export function paneOf(split: SplitPanes | null, tabId: string): 'left' | 'right' | null {
  if (!split) return null
  if (split.left === tabId) return 'left'
  if (split.right === tabId) return 'right'
  return null
}

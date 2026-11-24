/**
 * Post-processing for community detection: one Louvain phase on star-shaped schemas
 * (one hub table with many children, children chained to each other) tends to leave
 * lots of 2–3 table "clusters", which read as noise. This repeatedly folds the smallest
 * cluster under `minSize` into the neighbouring cluster it shares the most edge weight
 * with. Deterministic: ties go to the cluster whose first id sorts first.
 */
export function mergeSmallClusters(groups: string[][], adj: Map<string, Map<string, number>>, minSize = 4): string[][] {
  let list = groups.map((g) => [...g].sort())
  for (;;) {
    const owner = new Map<string, number>()
    list.forEach((g, i) => g.forEach((id) => owner.set(id, i)))
    const order = list.map((g, i) => i).filter((i) => (list[i]?.length ?? 0) < minSize)
    order.sort((a, b) => (list[a]?.length ?? 0) - (list[b]?.length ?? 0) || (list[a]?.[0] ?? '').localeCompare(list[b]?.[0] ?? ''))
    let mergedAny = false
    for (const i of order) {
      const weights = new Map<number, number>()
      for (const id of list[i] ?? []) {
        for (const [nb, w] of adj.get(id) ?? []) {
          const j = owner.get(nb)
          if (j !== undefined && j !== i) weights.set(j, (weights.get(j) ?? 0) + w)
        }
      }
      if (weights.size === 0) continue
      const [target] = [...weights.entries()].sort((a, b) => b[1] - a[1] || (list[a[0]]?.[0] ?? '').localeCompare(list[b[0]]?.[0] ?? ''))[0] ?? []
      if (target === undefined) continue
      list[target] = [...(list[target] ?? []), ...(list[i] ?? [])].sort()
      list[i] = []
      mergedAny = true
      break // owners changed; recompute
    }
    list = list.filter((g) => g.length > 0)
    if (!mergedAny) return list
  }
}

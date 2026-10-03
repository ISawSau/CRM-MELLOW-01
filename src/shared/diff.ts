/** Diferencias por líneas (LCS) para comparar versiones de copies y guiones. */
export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string }

const MAX_LINES = 2000

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n').slice(0, MAX_LINES)
  const b = after.split('\n').slice(0, MAX_LINES)
  const n = a.length
  const m = b.length
  // Tabla de longitudes de la subsecuencia común más larga, desde el final.
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ kind: 'removed', text: a[i++]! })
    else out.push({ kind: 'added', text: b[j++]! })
  }
  while (i < n) out.push({ kind: 'removed', text: a[i++]! })
  while (j < m) out.push({ kind: 'added', text: b[j++]! })
  return out
}

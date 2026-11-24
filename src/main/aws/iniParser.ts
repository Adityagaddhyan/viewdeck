/**
 * Minimal INI parser for ~/.aws/config and ~/.aws/credentials.
 *
 * Handles what the AWS CLI writes: `[section]` headers, `key = value` pairs,
 * `#` and `;` comment lines, and indented continuation lines for nested
 * sub-sections (e.g. `s3 =\n  max_concurrent_requests = 10`). Nested values are
 * ignored because no feature here needs them. Keys are lower-cased and section
 * names are kept verbatim.
 */
export type IniSections = Map<string, Record<string, string>>

export function parseIni(text: string): IniSections {
  const sections: IniSections = new Map()
  let current: Record<string, string> | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    if (/^\s+\S/.test(rawLine)) continue // Continuation or nested sub-key.
    const line = rawLine.trim()
    if (!line || line.startsWith('#') || line.startsWith(';')) continue

    const header = /^\[([^\]]+)\]$/.exec(line)
    if (header?.[1]) {
      const name = header[1].trim()
      current = sections.get(name) ?? {}
      sections.set(name, current)
      continue
    }

    const eq = line.indexOf('=')
    if (eq === -1 || !current) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1).trim()
    if (key) current[key] = value
  }
  return sections
}

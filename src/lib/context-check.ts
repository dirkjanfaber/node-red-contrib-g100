/**
 * Returns true if Node-RED's contextStorage default store uses localfilesystem,
 * meaning state will survive Node-RED restarts.
 *
 * Pass RED.settings?.contextStorage from the node constructor.
 */
export function isFileContextConfigured (contextStorage: unknown): boolean {
  if (!contextStorage || typeof contextStorage !== 'object') return false

  const storage = contextStorage as Record<string, unknown>
  const defaultEntry = storage.default

  if (defaultEntry !== undefined) {
    return resolveModule(defaultEntry, storage) === 'localfilesystem'
  }

  // No 'default' key: Node-RED uses the first defined store
  const firstKey = Object.keys(storage)[0]
  if (!firstKey) return false
  return resolveModule(storage[firstKey], storage) === 'localfilesystem'
}

/**
 * Resolves a store entry to its module name.
 * A store entry can be:
 *   - a string module name:            'localfilesystem'
 *   - a string reference to a store:  'file'  (looks up storage['file'])
 *   - an object with a module key:    { module: 'localfilesystem' }
 */
function resolveModule (
  entry: unknown,
  storage: Record<string, unknown>,
  visited: Set<string> = new Set()
): string | undefined {
  if (typeof entry === 'string') {
    if (visited.has(entry)) return undefined  // cycle — bail out
    // Could be a module name directly, or a reference to another store
    const referenced = storage[entry]
    if (referenced !== undefined) {
      visited.add(entry)
      return resolveModule(referenced, storage, visited)
    }
    return entry
  }
  if (entry && typeof entry === 'object') {
    return (entry as Record<string, unknown>).module as string | undefined
  }
  return undefined
}

import { isFileContextConfigured } from '../src/lib/context-check'

describe('isFileContextConfigured', () => {
  // ---- falsy / misconfigured -----------------------------------------------

  test('returns false when contextStorage is undefined', () => {
    expect(isFileContextConfigured(undefined)).toBe(false)
  })

  test('returns false when contextStorage is null', () => {
    expect(isFileContextConfigured(null)).toBe(false)
  })

  test('returns false when contextStorage is an empty object', () => {
    expect(isFileContextConfigured({})).toBe(false)
  })

  test('returns false when default store module is memory', () => {
    expect(isFileContextConfigured({
      default: { module: 'memory' }
    })).toBe(false)
  })

  test('returns false when default is a named store that uses memory', () => {
    expect(isFileContextConfigured({
      default: 'mem',
      mem: { module: 'memory' }
    })).toBe(false)
  })

  test('returns false when no default key and first store is memory', () => {
    expect(isFileContextConfigured({
      mem: { module: 'memory' }
    })).toBe(false)
  })

  // ---- correctly configured ------------------------------------------------

  test('returns true when default module is localfilesystem (inline object)', () => {
    expect(isFileContextConfigured({
      default: { module: 'localfilesystem' }
    })).toBe(true)
  })

  test('returns true when default is a named store that uses localfilesystem', () => {
    expect(isFileContextConfigured({
      default: 'file',
      memory: { module: 'memory' },
      file:   { module: 'localfilesystem' }
    })).toBe(true)
  })

  test('returns true when no default key and first store is localfilesystem', () => {
    expect(isFileContextConfigured({
      file: { module: 'localfilesystem' }
    })).toBe(true)
  })

  // ---- Node-RED allows shorthand strings too --------------------------------

  test('returns true when default is the string "localfilesystem"', () => {
    // contextStorage: { default: "localfilesystem" }
    expect(isFileContextConfigured({
      default: 'localfilesystem'
    })).toBe(true)
  })

  test('returns false when default is the string "memory"', () => {
    expect(isFileContextConfigured({
      default: 'memory'
    })).toBe(false)
  })

  test('returns true when named store value is a plain string "localfilesystem"', () => {
    expect(isFileContextConfigured({
      default: 'fs',
      fs: 'localfilesystem'
    })).toBe(true)
  })

  // ---- cycle safety --------------------------------------------------------

  test('does not throw on circular store references', () => {
    expect(() => isFileContextConfigured({
      default: 'storeA',
      storeA: 'storeB',
      storeB: 'storeA'
    })).not.toThrow()
  })

  test('returns false when circular store references prevent resolving a module', () => {
    expect(isFileContextConfigured({
      default: 'storeA',
      storeA: 'storeB',
      storeB: 'storeA'
    })).toBe(false)
  })
})

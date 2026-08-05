import { describe, expect, it } from 'vitest'

import {
  addConfigInclude,
  findConfigIncludes,
  findIncludeRewrite,
  includeTargetFor,
  isConfigIncluded,
  isIncludableConfigPath,
  normalizeConfigPath,
  removeConfigInclude,
  resolvableIncludeTarget,
  resolveIncludeTarget,
  resolvedIncludePaths,
} from '@/features/machine/includes'

describe('config includes', () => {
  it('finds include sections regardless of spacing and case', () => {
    const source = [
      '[printer]',
      '[include macros.cfg]',
      '  [ INCLUDE   sub/dir/thing.cfg ]  ',
      '[include]',
      '# [include commented.cfg]',
      '[includes not-a-section.cfg]',
    ].join('\n')

    expect(findConfigIncludes(source).map((entry) => entry.target)).toEqual([
      'macros.cfg',
      'sub/dir/thing.cfg',
    ])
  })

  it('reports offsets that isolate the target from the rest of the line', () => {
    const source = '[include macros.cfg]\n'
    const [include] = findConfigIncludes(source)

    expect(source.slice(include?.start, include?.end)).toBe('macros.cfg')
  })

  it('normalizes redundant separators and traversal', () => {
    expect(normalizeConfigPath('a//b')).toBe('a/b')
    expect(normalizeConfigPath('./a/./b')).toBe('a/b')
    expect(normalizeConfigPath('a/../b')).toBe('b')
    expect(normalizeConfigPath('a/b/../../c')).toBe('c')
    expect(normalizeConfigPath('../a')).toBe('../a')
  })

  it('resolves an include against the directory of the declaring file', () => {
    expect(resolveIncludeTarget('printer.cfg', 'macros.cfg')).toBe('macros.cfg')
    expect(resolveIncludeTarget('sub/printer.cfg', 'macros.cfg')).toBe('sub/macros.cfg')
    expect(resolveIncludeTarget('sub/printer.cfg', '../macros.cfg')).toBe('macros.cfg')
  })

  it('resolves a hotlink target for the editor, unless it is a glob or escapes the config root', () => {
    expect(resolvableIncludeTarget('printer.cfg', 'hardware/steppers.cfg')).toBe(
      'hardware/steppers.cfg',
    )
    expect(resolvableIncludeTarget('sub/printer.cfg', '../macros.cfg')).toBe('macros.cfg')
    expect(resolvableIncludeTarget('printer.cfg', 'conf.d/*.cfg')).toBeNull()
    expect(resolvableIncludeTarget('printer.cfg', '../outside.cfg')).toBeNull()
  })

  it('expresses a target relative to the declaring file, including upwards', () => {
    expect(includeTargetFor('printer.cfg', 'sub/macros.cfg')).toBe('sub/macros.cfg')
    expect(includeTargetFor('sub/printer.cfg', 'macros.cfg')).toBe('../macros.cfg')
    expect(includeTargetFor('a/printer.cfg', 'b/macros.cfg')).toBe('../b/macros.cfg')
    expect(includeTargetFor('a/b/printer.cfg', 'a/macros.cfg')).toBe('../macros.cfg')
  })

  it('rewrites the include that pointed at a file moved into a folder', () => {
    const source = '[printer]\n[include macros.cfg]\n[include other.cfg]\n'
    const rewrite = findIncludeRewrite(source, 'printer.cfg', 'macros.cfg', 'sub/macros.cfg')

    expect(rewrite).not.toBeNull()
    expect(rewrite?.from).toBe('macros.cfg')
    expect(rewrite?.to).toBe('sub/macros.cfg')
    expect(rewrite?.content).toBe('[printer]\n[include sub/macros.cfg]\n[include other.cfg]\n')
  })

  it('rewrites an include for a file moved back up to the root', () => {
    const source = '[include sub/macros.cfg]\n'

    expect(findIncludeRewrite(source, 'printer.cfg', 'sub/macros.cfg', 'macros.cfg')?.content).toBe(
      '[include macros.cfg]\n',
    )
  })

  it('leaves the rest of the line and file untouched', () => {
    const source = '  [ include   macros.cfg ]  \n[printer]\n'

    expect(findIncludeRewrite(source, 'printer.cfg', 'macros.cfg', 'sub/macros.cfg')?.content).toBe(
      '  [ include   sub/macros.cfg ]  \n[printer]\n',
    )
  })

  it('returns null when no include refers to the moved file', () => {
    const source = '[include other.cfg]\n'

    expect(findIncludeRewrite(source, 'printer.cfg', 'macros.cfg', 'sub/macros.cfg')).toBeNull()
  })

  it('refuses to rewrite a glob, which may cover files that did not move', () => {
    const source = '[include sub/*.cfg]\n'

    expect(findIncludeRewrite(source, 'printer.cfg', 'sub/a.cfg', 'other/a.cfg')).toBeNull()
  })

  it('returns null when the include already reads correctly', () => {
    const source = '[include sub/macros.cfg]\n'

    // A move between directories that resolves to the same declared target.
    expect(findIncludeRewrite(source, 'printer.cfg', 'sub/macros.cfg', 'sub/macros.cfg')).toBeNull()
  })

  it('recognizes cfg and conf files as includable, regardless of case', () => {
    expect(isIncludableConfigPath('macros.cfg')).toBe(true)
    expect(isIncludableConfigPath('sub/dir/thing.CONF')).toBe(true)
    expect(isIncludableConfigPath('notes.txt')).toBe(false)
    expect(isIncludableConfigPath('.cfg')).toBe(false)
    expect(isIncludableConfigPath('no-extension')).toBe(false)
  })

  it('appends an include for a file not yet referenced', () => {
    const source = '[printer]\n[include macros.cfg]\n'

    expect(addConfigInclude(source, 'printer.cfg', 'mob.cfg')).toBe(
      '[printer]\n[include macros.cfg]\n[include mob.cfg]\n',
    )
  })

  it('adds a trailing newline before the new include when the file lacks one', () => {
    const source = '[printer]'

    expect(addConfigInclude(source, 'printer.cfg', 'mob.cfg')).toBe(
      '[printer]\n[include mob.cfg]\n',
    )
  })

  it('expresses the new include relative to the declaring file', () => {
    const source = ''

    expect(addConfigInclude(source, 'sub/printer.cfg', 'sub/macros.cfg')).toBe(
      '[include macros.cfg]\n',
    )
  })

  it('returns null when a literal include already covers the file', () => {
    const source = '[include sub/macros.cfg]\n'

    expect(addConfigInclude(source, 'printer.cfg', 'sub/macros.cfg')).toBeNull()
  })

  it('adds the include when only a glob exists, since it may not cover the file', () => {
    const source = '[include sub/*.cfg]\n'

    expect(addConfigInclude(source, 'printer.cfg', 'sub/macros.cfg')).toBe(
      '[include sub/*.cfg]\n[include sub/macros.cfg]\n',
    )
  })

  it('inserts the new include above the SAVE_CONFIG block instead of after it', () => {
    const source = [
      '[printer]',
      '[include macros.cfg]',
      '',
      '#*# <---------------------- SAVE_CONFIG ---------------------->',
      '#*# DO NOT EDIT THIS BLOCK OR BELOW. The contents are auto-generated.',
      '#*#',
      '#*# [bed_mesh default]',
      '',
    ].join('\n')

    expect(addConfigInclude(source, 'printer.cfg', 'mob.cfg')).toBe(
      [
        '[printer]',
        '[include macros.cfg]',
        '[include mob.cfg]',
        '',
        '#*# <---------------------- SAVE_CONFIG ---------------------->',
        '#*# DO NOT EDIT THIS BLOCK OR BELOW. The contents are auto-generated.',
        '#*#',
        '#*# [bed_mesh default]',
        '',
      ].join('\n'),
    )
  })

  it('still separates the new include from the SAVE_CONFIG block with a blank line', () => {
    const source = '[printer]\n#*# <---------------------- SAVE_CONFIG ---------------------->\n'

    expect(addConfigInclude(source, 'printer.cfg', 'mob.cfg')).toBe(
      '[printer]\n[include mob.cfg]\n\n#*# <---------------------- SAVE_CONFIG ---------------------->\n',
    )
  })

  it('handles a SAVE_CONFIG block with nothing above it', () => {
    const source = '#*# <---------------------- SAVE_CONFIG ---------------------->\n'

    expect(addConfigInclude(source, 'printer.cfg', 'mob.cfg')).toBe(
      '[include mob.cfg]\n\n#*# <---------------------- SAVE_CONFIG ---------------------->\n',
    )
  })

  it('resolves every literal include, skipping globs, to a path relative to the config root', () => {
    const source =
      '[printer]\n[include macros.cfg]\n[include sub/other.cfg]\n[include glob/*.cfg]\n'

    expect(resolvedIncludePaths(source, 'printer.cfg')).toEqual(
      new Set(['macros.cfg', 'sub/other.cfg']),
    )
  })

  it('reports a file as included only via a literal match', () => {
    const source = '[include sub/macros.cfg]\n[include glob/*.cfg]\n'

    expect(isConfigIncluded(source, 'printer.cfg', 'sub/macros.cfg')).toBe(true)
    expect(isConfigIncluded(source, 'printer.cfg', 'glob/anything.cfg')).toBe(false)
    expect(isConfigIncluded(source, 'printer.cfg', 'other.cfg')).toBe(false)
  })

  it('removes the include line that resolves to the target file', () => {
    const source = '[printer]\n[include macros.cfg]\n[include other.cfg]\n'

    expect(removeConfigInclude(source, 'printer.cfg', 'macros.cfg')).toBe(
      '[printer]\n[include other.cfg]\n',
    )
  })

  it('returns null when removing an include that is not present', () => {
    const source = '[include other.cfg]\n'

    expect(removeConfigInclude(source, 'printer.cfg', 'macros.cfg')).toBeNull()
  })

  it('leaves a glob untouched when asked to remove a literal path', () => {
    const source = '[include sub/*.cfg]\n'

    expect(removeConfigInclude(source, 'printer.cfg', 'sub/macros.cfg')).toBeNull()
  })
})

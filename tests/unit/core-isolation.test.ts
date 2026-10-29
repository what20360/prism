import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const CORE_DIR = join(process.cwd(), 'src', 'core')

/** Any import that points at an outer layer or at concrete content. */
const FORBIDDEN_SEGMENT = /(^|\/)(app|ui|render|input|net|storage|content)\//

function listTsFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...listTsFiles(full))
    } else if (full.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files
}

describe('core isolation', () => {
  it('never imports outer layers or concrete content', () => {
    const violations: string[] = []

    for (const file of listTsFiles(CORE_DIR)) {
      const source = readFileSync(file, 'utf8')
      const specifiers = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)]

      for (const match of specifiers) {
        const specifier = (match[1] ?? '').replace(/\\/g, '/')
        if (FORBIDDEN_SEGMENT.test(specifier)) {
          violations.push(`${relative(CORE_DIR, file)} -> ${specifier}`)
        }
      }
    }

    expect(violations).toEqual([])
  })
})

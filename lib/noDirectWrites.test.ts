// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

// After shared backend 6/6, members can't write these tables directly — any
// leftover direct write in website code would silently do nothing. Admin
// code (app/admin, lib/actions/admin*, emailAdmin) and service-role code
// are allowed.
const LOCKED = ['conversations', 'listings', 'listing_books', 'disputes']
const ALLOWED = [/app[\\/]admin[\\/]/, /lib[\\/]actions[\\/](admin|emailAdmin)\.ts$/, /lib[\\/]disputes[\\/]notifyAdmins\.ts$/, /app[\\/]api[\\/]cron[\\/]/]

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe('website code', () => {
  it('never writes locked tables directly', () => {
    const offenders: string[] = []
    for (const file of [...sourceFiles('app'), ...sourceFiles('lib'), ...sourceFiles('components')]) {
      if (ALLOWED.some((re) => re.test(file))) continue
      const src = readFileSync(file, 'utf8')
      for (const table of LOCKED) {
        const re = new RegExp(`from\\('${table}'\\)[\\s\\S]{0,80}?\\.(insert|update|delete|upsert)\\(`, 'g')
        if (re.test(src)) offenders.push(`${file} → ${table}`)
      }
      if (/from\('messages'\)[\s\S]{0,120}?kind:\s*'(?!chat)/.test(src)) offenders.push(`${file} → messages (non-chat kind)`)
    }
    expect(offenders).toEqual([])
  })
})

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const sourcePath = '.openai/source.json'
const source = existsSync(sourcePath) ? JSON.parse(readFileSync(sourcePath, 'utf8')) : undefined
const commit = process.env.GITHUB_SHA ?? source?.commit_sha ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()

if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Expected a full source commit SHA')

writeFileSync('dist/version.json', JSON.stringify({
  repository: source?.repository ?? 'what20360/prism',
  branch: source?.branch ?? 'main',
  commit_sha: commit,
  built_at: new Date().toISOString(),
}, null, 2) + '\n')

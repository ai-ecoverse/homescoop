import { readFileSync } from 'node:fs'

const RECIPE = new URL('../../recipe.yaml', import.meta.url)

const recipe = () => readFileSync(RECIPE, 'utf8')

export function recipeVersion (text = recipe()) {
  const m = /^version: "(\d+\.\d+\.\d+)"$/m.exec(text)
  if (!m) throw new Error('wasi-fastly: recipe.yaml names no X.Y.Z version')
  return m[1]
}

function sourceField (text, field) {
  const block = /^source:\n((?: {2}.*\n)+)/m.exec(text)
  const m = block && new RegExp(`^ {2}${field}: "([^"]*)"$`, 'm').exec(block[1])
  return m ? m[1] : null
}

export function recipeCommit (text = recipe()) {
  const commit = sourceField(text, 'commit')
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) throw new Error('wasi-fastly: recipe.yaml names no 40-hex source.commit')
  return commit
}

export function recipeTag (text = recipe()) {
  const tag = sourceField(text, 'tag')
  if (!tag) throw new Error('wasi-fastly: recipe.yaml names no source.tag')
  return tag.replaceAll('{{version}}', recipeVersion(text))
}

export const shortCommit = (commit = recipeCommit()) => commit.slice(0, 7)

const esc = value => value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

export function versionPattern (version = recipeVersion(), commit = shortCommit()) {
  return new RegExp(`^Fastly CLI version v${esc(version)} \\(${esc(commit)}\\)\\nBuilt with go version go1\\.\\d+\\.\\d+ wasip1\\/wasm \\(\\d{4}-\\d\\d-\\d\\d\\)\\n$`)
}

export function agentPattern (version = recipeVersion()) {
  return new RegExp(`^FastlyCLI\\/v${esc(version)}, FastlyGo\\/`)
}

#!/usr/bin/env node
// bin/cli.mjs
// The way the shipped instructions get out of node_modules.
//
// A package can carry the best agent instructions ever written and it makes no
// difference if nobody finds them: the files sit four directories deep under a
// name the reader has to already know. So this puts them one command away —
// print the rules, list the modules, copy the agent definitions into the
// project where the tooling already looks for them.
//
// Plain ESM, node builtins only, published as-is and never compiled, so it runs
// from a fresh `npx` with nothing installed but this package.
//
//   npx threejs-scene agents install
//   npx threejs-scene rules SC004
//   npx threejs-scene doctor

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'


const HERE = dirname(fileURLToPath(import.meta.url))
const PKG  = resolve(HERE, '..')
const CWD  = process.cwd()

const ESC   = String.fromCharCode(27)
const COLOR = process.stdout.isTTY && !process.env.NO_COLOR
const paint = (code, text) => COLOR ? `${ESC}[${code}m${text}${ESC}[0m` : text

const bold  = text => paint(1, text)
const dim   = text => paint(2, text)
const red   = text => paint(31, text)
const green = text => paint(32, text)

/** Exit with a message that names the file, rather than a stack trace. */
function fail (message, hint) {
  console.error(`${red('threejs-scene:')} ${message}`)

  if (hint)
    console.error(dim(`  ${hint}`))

  process.exit(1)
}

/**
 * Read a JSON payload shipped with the package.
 *
 * @param path - Path relative to the package root.
 * @returns The parsed payload.
 */
function payload (path) {
  const file = join(PKG, path)

  if (!existsSync(file))
    fail(
      `${path} is missing from the installed package.`,
      'It is generated at publish time by `npm run llm:assets`. Reinstall threejs-scene, or run that script if you are working in a clone.',
    )

  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  }
  catch (error) {
    return fail(`${path} is not readable JSON: ${error.message}`, 'Reinstall threejs-scene.')
  }
}

/** Parse `--flag value` and `--flag` out of argv, returning both halves. */
function parseFlags (argv) {
  const flags = {}
  const rest  = []

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]

    if (!token.startsWith('--')) {
      rest.push(token)
      continue
    }

    const name = token.slice(2)
    const next = argv[index + 1]

    if (next && !next.startsWith('--')) {
      flags[name] = next
      index += 1
    }
    else
      flags[name] = true
  }

  return { flags, rest }
}

/** Where project-level tooling files go, preferring an existing .claude/. */
function defaultTarget (leaf) {
  return existsSync(join(CWD, '.claude')) ? join(CWD, '.claude', leaf) : join(CWD, leaf)
}

/**
 * Copy files into a target directory without ever silently clobbering.
 *
 * @param files - Absolute source paths.
 * @param target - Absolute destination directory.
 * @param force - Overwrite existing files.
 * @returns Counts of written and skipped files.
 */
function copyInto (files, target, force) {
  mkdirSync(target, { recursive: true })

  let written = 0
  let skipped = 0

  for (const source of files) {
    const destination = join(target, basename(source))
    const exists      = existsSync(destination)

    if (exists && !force) {
      console.log(`  ${dim('skip')}  ${basename(source)} ${dim('(already exists — pass --force to overwrite)')}`)
      skipped += 1
      continue
    }

    cpSync(source, destination)
    console.log(`  ${green(exists ? 'over ' : 'write')}  ${relative(CWD, destination)}`)
    written += 1
  }

  return { written, skipped }
}

/** The shipped agent definition files, sorted. */
function agentFiles () {
  const dir = join(PKG, 'llm', 'agents')

  if (!existsSync(dir))
    fail('llm/agents is missing from the installed package.', 'Reinstall threejs-scene.')

  return readdirSync(dir)
    .filter(name => name.endsWith('.md'))
    .sort()
    .map(name => join(dir, name))
}

/** The `name` and `description` from a markdown file's YAML frontmatter. */
function frontmatter (file) {
  const text  = readFileSync(file, 'utf8')
  const match = (/^---\n([\s\S]*?)\n---/u).exec(text)

  if (!match)
    return { name: basename(file, '.md'), description: '' }

  const read = key => {
    const found = new RegExp(`^${key}:\\s*(.+)$`, 'mu').exec(match[1])
    return found ? found[1].trim().replace(/^["']|["']$/gu, '') : ''
  }

  return { name: read('name') || basename(file, '.md'), description: read('description') }
}

// ── commands ────────────────────────────────────────────────────────────────

function commandAgents (argv) {
  const { flags, rest } = parseFlags(argv)
  const action          = rest[0] ?? 'install'
  const files           = agentFiles()

  if (action === 'list' || flags.list) {
    console.log(bold(`\n${files.length} agent definitions\n`))

    for (const file of files) {
      const { name, description } = frontmatter(file)

      console.log(`  ${bold(name)}`)
      console.log(`  ${dim(description || '(no description)')}\n`)
    }

    return 0
  }

  if (action !== 'install')
    return fail(`unknown subcommand \`agents ${action}\`.`, 'Try: threejs-scene agents install [--target <dir>] [--force], or agents list')

  const target = resolve(CWD, flags.target ?? defaultTarget('agents'))

  console.log(bold(`\nInstalling ${files.length} agent definitions into ${relative(CWD, target) || '.'}\n`))

  const { written, skipped } = copyInto(files, target, Boolean(flags.force))

  console.log(`\n${written} written, ${skipped} skipped.\n`)
  return 0
}

function commandInstructions (argv) {
  const { flags } = parseFlags(argv)
  const source    = join(PKG, 'llm', 'AGENTS.md')

  if (!existsSync(source))
    return fail('llm/AGENTS.md is missing from the installed package.', 'Reinstall threejs-scene.')

  const text = readFileSync(source, 'utf8')

  if (flags.print) {
    process.stdout.write(text)
    return 0
  }

  const target = resolve(CWD, flags.target ?? CWD)
  const wanted = join(target, 'AGENTS.md')

  // never clobber a project's own instructions: they are the thing a reader
  // trusts most, and a package that overwrites them earns a permanent uninstall
  const destination = existsSync(wanted) && !flags.force
    ? join(target, 'threejs-scene.AGENTS.md')
    : wanted

  mkdirSync(target, { recursive: true })
  writeFileSync(destination, text)

  console.log(`${green('write')}  ${relative(CWD, destination)}`)

  if (destination !== wanted)
    console.log(dim('       AGENTS.md already exists and was left alone. Include the new file from it, or pass --force.'))

  return 0
}

function commandRules (argv) {
  const { flags, rest } = parseFlags(argv)
  const { rules }       = payload('llm/rules.json')
  const wanted          = rest[0]

  if (flags.json) {
    console.log(JSON.stringify(wanted ? rules.filter(rule => rule.code === wanted || rule.id === wanted) : rules, null, 2))
    return 0
  }

  if (wanted) {
    const rule = rules.find(entry => entry.code === wanted || entry.id === wanted)

    if (!rule)
      return fail(`no rule \`${wanted}\`.`, `Known codes: ${rules.map(entry => entry.code).join(', ')}`)

    console.log(`\n${bold(`${rule.code} · ${rule.id}`)}  ${dim(`[${rule.severity}, enforced by ${rule.enforcedBy.join(', ')}]`)}`)
    console.log(`${bold(rule.title)}\n`)
    console.log(`${rule.rationale}\n`)
    console.log(`${red('wrong')}  ${rule.wrong}`)
    console.log(`${green('right')}  ${rule.right}\n`)
    return 0
  }

  console.log(bold('\nthreejs-scene — enforced rules\n'))

  for (const rule of rules)
    console.log(`  ${bold(rule.code)}  ${rule.id.padEnd(24)} ${dim(`[${rule.severity}]`)} ${rule.title}`)

  console.log(dim('\n  threejs-scene rules SC004   for one rule in full\n'))
  return 0
}

function commandModules (argv) {
  const { flags }                 = parseFlags(argv)
  const { modules, capabilities } = payload('llm/modules.json')

  const shown = flags.capability
    ? modules.filter(entry => entry.provides.includes(flags.capability) || entry.requires.includes(flags.capability))
    : modules

  if (flags.json) {
    console.log(JSON.stringify({ modules: shown, capabilities }, null, 2))
    return 0
  }

  console.log(bold(`\n${shown.length} modules\n`))

  for (const entry of shown) {
    console.log(`  ${bold(entry.id)}  ${dim(`${entry.subpath} · ${entry.factory}() · ${entry.cost}`)}`)
    console.log(`  ${entry.summary}`)

    if (entry.provides.length)
      console.log(dim(`  provides: ${entry.provides.join(', ')}`))

    if (entry.requires.length)
      console.log(dim(`  requires: ${entry.requires.join(', ')}`))

    if (entry.peers.length)
      console.log(dim(`  peer dependency: ${entry.peers.join(', ')}`))

    console.log('')
  }

  return 0
}

function commandSkill (argv) {
  const { flags } = parseFlags(argv)
  const source    = join(PKG, 'llm', 'skills', 'threejs-scene')

  if (!existsSync(source))
    return fail('llm/skills/threejs-scene is missing from the installed package.', 'Reinstall threejs-scene.')

  const target = resolve(CWD, flags.target ?? defaultTarget('skills'), 'threejs-scene')

  if (existsSync(target) && !flags.force)
    return fail(`${relative(CWD, target)} already exists.`, 'Pass --force to overwrite it.')

  cpSync(source, target, { recursive: true })
  console.log(`${green('write')}  ${relative(CWD, target)}/`)
  return 0
}

function commandDoctor () {
  const version = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')).version
  const wanted  = [
    'llms.txt',
    'llm/AGENTS.md',
    'llm/RULES.md',
    'llm/rules.json',
    'llm/modules.json',
    'llm/agents',
    'llm/skills/threejs-scene',
    'eslint/index.mjs',
  ]

  console.log(bold(`\nthreejs-scene ${version}`))
  console.log(dim(`installed at ${PKG}\n`))

  let missing = 0

  for (const path of wanted) {
    const ok = existsSync(join(PKG, path))

    if (!ok)
      missing += 1

    console.log(`  ${ok ? green('ok  ') : red('MISS')}  ${path}`)
  }

  if (missing > 0) {
    console.error(`\n${red(`${missing} shipped file(s) missing.`)} Reinstall threejs-scene.\n`)
    return 1
  }

  console.log(green('\nAll shipped instructions present.\n'))
  return 0
}

function commandHelp () {
  console.log(`
${bold('threejs-scene')} — the instructions this package ships, one command away

  ${bold('agents install')} [--target <dir>] [--force]   copy the agent definitions into your project
  ${bold('agents list')}                                 show what would be copied
  ${bold('instructions')} [--target <dir>] [--print]     write AGENTS.md into your project, or print it
  ${bold('rules')} [<code|id>] [--json]                  the enforced rules; one in full when named
  ${bold('modules')} [--capability <name>] [--json]      the module catalogue
  ${bold('skill')} [--target <dir>] [--force]            copy the skill into .claude/skills
  ${bold('doctor')}                                      check the install is complete
  ${bold('help')}

${dim('Agent definitions default to .claude/agents when a .claude directory exists, else ./agents.')}
`)
  return 0
}

const COMMANDS = {
  agents:       commandAgents,
  instructions: commandInstructions,
  rules:        commandRules,
  modules:      commandModules,
  skill:        commandSkill,
  doctor:       commandDoctor,
  help:         commandHelp,
}

const [ name, ...argv ] = process.argv.slice(2)
const command           = COMMANDS[name ?? 'help']

if (!command) {
  console.error(`${red('threejs-scene:')} unknown command \`${name}\`.`)
  commandHelp()
  process.exit(1)
}

process.exit(command(argv) ?? 0)

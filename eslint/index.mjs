// eslint/index.mjs
// Static enforcement of the package contract.
//
// The runtime catches a violation the first time the offending line runs, which
// for a `dispose` that never releases a texture means "in production, on the
// twelfth remount". The linter catches the same shapes before they run. It is
// published as plain ESM and never compiled, so it loads directly from
// node_modules in a consumer's eslint.config.mjs.
//
// Rule names are the kebab ids from lib/llm/rules.ts, so a finding reported here
// and a violation reported at runtime carry the same name and the same code.
//
//   import threejsScene from 'threejs-scene/eslint'
//   export default [ ...threejsScene.configs.recommended ]

const DOCS = 'https://github.com/tuomashatakka/threejs-scene/blob/main/llm/RULES.md'

/** The lifecycle method names, as they appear on a module literal. */
const LIFECYCLE = new Set([ 'setup', 'build', 'start', 'update', 'resize', 'render', 'stop', 'dispose' ])

/**
 * Paths where wall-clock time and unseeded randomness are legitimate: tests and
 * demos, the clock itself, and raw input handling — a tap threshold is a claim
 * about a human's thumb, not about the simulation, and measuring it against
 * `frame.elapsed` would make it change with the frame rate.
 */
const EXEMPT = /[\\/](?:tests?|site|scripts)[\\/]|[\\/]lib[\\/](?:time|input)[\\/]|\.(?:test|spec)\.[cm]?[jt]sx?$/u

function url (code) {
  return `${DOCS}#${code.toLowerCase()}`
}

/**
 * Whether this file is module-shaped: it authors an AppModule, so the lifecycle
 * rules apply to its methods. A file that merely imports the package is not.
 */
function authorsModule (context) {
  const text = context.sourceCode.getText()
  return (/\bdefineModule\b|\bdefineScopedModule\b|\bAppModule\b|\bModuleContext\b/u).test(text)
}

/** The nearest enclosing object-literal method name, or null. */
function enclosingLifecycle (node) {
  for (let current = node; current; current = current.parent) {
    const { parent } = current

    if (!parent)
      return null

    const isMethod = (parent.type === 'Property' || parent.type === 'MethodDefinition') &&
      parent.value === current

    if (isMethod && parent.key && LIFECYCLE.has(parent.key.name ?? parent.key.value))
      return parent.key.name ?? parent.key.value
  }

  return null
}

/** `a.b.c` as a dotted string, or null when the chain is computed. */
function memberPath (node) {
  const parts = []

  for (let current = node; current; current = current.object) {
    if (current.type === 'Identifier') {
      parts.unshift(current.name)
      return parts.join('.')
    }

    if (current.type !== 'MemberExpression' || current.computed || current.property.type !== 'Identifier')
      return null

    parts.unshift(current.property.name)
  }

  return null
}

/**
 * Whether a call is `ctx.<root>.<tail>(…)` — on the module context specifically.
 *
 * The `ctx.` prefix is load-bearing. `createApp` itself calls `loop.onFrame` and
 * `scene.add` on its own locals, and it must: it is the app. Matching a bare
 * `.loop.onFrame` would flag the one place in the package that is allowed to
 * own the loop, which is how a linter earns a blanket disable comment.
 */
function callsModuleContext (node, root, tail) {
  const path = node.callee.type === 'MemberExpression' ? memberPath(node.callee) : null
  return path !== null && (/(?:^|\.)ctx\./u).test(path) && path.endsWith(`${root}.${tail}`)
}

const singleFrameLoop = {
  meta: {
    type:     'problem',
    docs:     { description: 'createApp owns the only frame loop', url: url('SC001') },
    schema:   [],
    messages: {
      raf:  '[SC001 single-frame-loop] {{api}} inside a module. createApp owns the only frame loop — animate in update(), where the frame delta is already handed to you.',
      loop: '[SC001 single-frame-loop] a module subscribed to ctx.loop. The loop belongs to the app; a module that runs outside a tick sees torn state and keeps running after dispose.',
    },
  },
  create (context) {
    if (!authorsModule(context))
      return {}

    return {
      CallExpression (node) {
        if (callsModuleContext(node, 'loop', 'onFrame') || callsModuleContext(node, 'loop', 'start')) {
          context.report({ node, messageId: 'loop' })
          return
        }

        if (node.callee.type !== 'Identifier')
          return

        if ([ 'requestAnimationFrame', 'setInterval' ].includes(node.callee.name) && enclosingLifecycle(node))
          context.report({ node, messageId: 'raf', data: { api: node.callee.name }})
      },
    }
  },
}

const noNondeterminism = {
  meta: {
    type:     'problem',
    docs:     { description: 'take randomness from ctx.rng and time from frame', url: url('SC002') },
    schema:   [],
    messages: {
      random: '[SC002 no-nondeterminism] Math.random() makes the same seed produce a different world. Use ctx.rng — fork it per consumer: ctx.rng.fork(\'trees\').range(1, 3).',
      time:   '[SC002 no-nondeterminism] {{api}} is wall-clock time, so a replay of the same ticks renders differently. Take time from frame.elapsed / frame.delta.',
    },
  },
  create (context) {
    if (EXEMPT.test(context.filename))
      return {}

    return {
      CallExpression (node) {
        const path = node.callee.type === 'MemberExpression' ? memberPath(node.callee) : null

        if (path === 'Math.random') {
          context.report({ node, messageId: 'random' })
          return
        }

        if (path === 'Date.now' || path === 'performance.now')
          context.report({ node, messageId: 'time', data: { api: `${path}()` }})
      },
      NewExpression (node) {
        if (node.callee.name === 'Date' && node.arguments.length === 0)
          context.report({ node, messageId: 'time', data: { api: 'new Date()' }})
      },
    }
  },
}

const forkRngByName = {
  meta: {
    type:     'suggestion',
    docs:     { description: 'fork the rng per consumer, by label', url: url('SC003') },
    schema:   [],
    messages: {
      fork: '[SC003 fork-rng-by-name] drawing straight from the shared stream couples this to every other consumer\'s draw order — adding one tree reshuffles every rock. Fork by label first: ctx.rng.fork(\'trees\').{{method}}(…).',
    },
  },
  create (context) {
    const DRAWS = new Set([ 'next', 'range', 'int', 'pick' ])

    return {
      CallExpression (node) {
        if (node.callee.type !== 'MemberExpression' || node.callee.computed)
          return

        const method = node.callee.property.name

        if (!DRAWS.has(method))
          return

        const path = memberPath(node.callee)

        if (path !== 'ctx.rng.' + method && path !== 'rng.' + method)
          return

        if (enclosingLifecycle(node) === 'build')
          context.report({ node, messageId: 'fork', data: { method }})
      },
    }
  },
}

const scopedRoot = {
  meta: {
    type:     'problem',
    docs:     { description: 'build into ctx.root, never straight into ctx.scene', url: url('SC004') },
    schema:   [],
    messages: {
      scene: '[SC004 scoped-root] adding to ctx.scene puts this object outside the module\'s scope. Use ctx.root.add(…) — the runtime attaches it at mount and disposes it at teardown.',
    },
  },
  create (context) {
    if (!authorsModule(context))
      return {}

    return {
      CallExpression (node) {
        if (!callsModuleContext(node, 'scene', 'add'))
          return

        if (enclosingLifecycle(node))
          context.report({ node, messageId: 'scene' })
      },
    }
  },
}

const noStateWriteInUpdate = {
  meta: {
    type:     'problem',
    docs:     { description: 'never write app state from inside a lifecycle hook', url: url('SC006') },
    schema:   [],
    messages: {
      mutate: '[SC006 no-state-write-in-update] the state view is read-only — writing it mid-tick means the modules before and after this one saw different worlds. Use ctx.commit({{{prop}}: …}).',
      write:  '[SC006 no-state-write-in-update] {{api}} from inside {{phase}}() applies mid-tick. Use ctx.commit(patch); the runtime drains it at the tick boundary.',
    },
  },
  create (context) {
    if (!authorsModule(context))
      return {}

    /** The first parameter name of the enclosing update() method, or null. */
    function updateViewParam (node) {
      for (let current = node; current; current = current.parent) {
        const { parent } = current

        if (!parent)
          return null

        const isMethod = (parent.type === 'Property' || parent.type === 'MethodDefinition') && parent.value === current

        if (isMethod && (parent.key.name ?? parent.key.value) === 'update')
          return current.params?.[0]?.type === 'Identifier' ? current.params[0].name : null
      }

      return null
    }

    return {
      AssignmentExpression (node) {
        if (node.left.type !== 'MemberExpression' || node.left.object.type !== 'Identifier')
          return

        const view = updateViewParam(node)

        if (view && node.left.object.name === view)
          context.report({
            node,
            messageId: 'mutate',
            data:      { prop: node.left.property.name ?? 'field' },
          })
      },
      CallExpression (node) {
        const phase = enclosingLifecycle(node)

        if (!phase)
          return

        const path = node.callee.type === 'MemberExpression'
          ? memberPath(node.callee)
          : node.callee.name

        if (!path)
          return

        const bare = path.split('.').slice(-2)
          .join('.')

        if (path === 'setState' || bare.endsWith('.setState') || bare === 'store.set' || bare.endsWith('.dispatch') && !bare.startsWith('ctx.'))
          context.report({ node, messageId: 'write', data: { api: path, phase }})
      },
    }
  },
}

const syncLifecycle = {
  meta: {
    type:     'problem',
    docs:     { description: 'lifecycle hooks are synchronous', url: url('SC017') },
    schema:   [],
    messages: {
      async: '[SC017 sync-lifecycle] async {{phase}}() resolves after the phase it belongs to has finished — the runtime has already started the next module, or already disposed this one. Load first, then mount a module with what you loaded.',
    },
  },
  create (context) {
    if (!authorsModule(context))
      return {}

    return {
      'Property > :function' (node) {
        const key = node.parent.key

        if (!node.async || !key || !LIFECYCLE.has(key.name ?? key.value))
          return

        context.report({ node: node.parent, messageId: 'async', data: { phase: key.name ?? key.value }})
      },
    }
  },
}

const domFreeAssets = {
  meta: {
    type:     'problem',
    docs:     { description: 'keep modules/assets DOM-free and SSR-safe', url: url('SC014') },
    schema:   [],
    messages: {
      dom: '[SC014 dom-free-assets] {{api}} in the asset layer. Textures are DataTexture, never a canvas — that is the only reason this layer runs in a headless test and inside a server render.',
    },
  },
  create (context) {
    if (!(/[\\/]modules[\\/]assets[\\/]/u).test(context.filename))
      return {}

    return {
      MemberExpression (node) {
        if (node.object.type !== 'Identifier')
          return

        if ([ 'document', 'window' ].includes(node.object.name))
          context.report({ node, messageId: 'dom', data: { api: node.object.name }})
      },
      NewExpression (node) {
        if (node.callee.type === 'Identifier' && [ 'Image', 'OffscreenCanvas' ].includes(node.callee.name))
          context.report({ node, messageId: 'dom', data: { api: `new ${node.callee.name}()` }})
      },
    }
  },
}

const rules = {
  'single-frame-loop':        singleFrameLoop,
  'no-nondeterminism':        noNondeterminism,
  'fork-rng-by-name':         forkRngByName,
  'scoped-root':              scopedRoot,
  'no-state-write-in-update': noStateWriteInUpdate,
  'sync-lifecycle':           syncLifecycle,
  'dom-free-assets':          domFreeAssets,
}

const plugin = {
  meta: { name: 'threejs-scene', version: '0.7.0' },
  rules,
}

// severities mirror lib/llm/rules.ts: the ones that produce code which runs and
// is still wrong are errors; the ones that produce code which is merely fragile
// are warnings.
plugin.configs = {
  recommended: [
    {
      name:    'threejs-scene/recommended',
      plugins: { 'threejs-scene': plugin },
      rules:   {
        'threejs-scene/single-frame-loop':        'error',
        'threejs-scene/no-nondeterminism':        'error',
        'threejs-scene/fork-rng-by-name':         'warn',
        'threejs-scene/scoped-root':              'error',
        'threejs-scene/no-state-write-in-update': 'error',
        'threejs-scene/sync-lifecycle':           'error',
        'threejs-scene/dom-free-assets':          'error',
      },
    },
  ],
}

export default plugin
export { rules }
export const configs = plugin.configs

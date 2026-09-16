// eslint/index.d.ts
// Types for the flat-config plugin. Hand-written rather than generated: the
// plugin itself is plain JavaScript published uncompiled, so there is no build
// step to emit these from.

/** One ESLint rule module, as the flat config consumes it. */
export interface PluginRule {
  meta: {
    type:     'problem' | 'suggestion' | 'layout'
    docs:     { description: string, url: string }
    schema:   []
    messages: Record<string, string>
  }
  create (context: unknown): Record<string, (node: unknown) => void>
}

/** A flat-config entry contributed by this plugin. */
export interface FlatConfig {
  name?:    string
  plugins?: Record<string, unknown>
  rules?:   Record<string, 'off' | 'warn' | 'error'>
}

/** The rules, keyed by the kebab ids from the shared rule catalogue. */
export declare const rules: Record<
  | 'single-frame-loop' |
  'no-nondeterminism' |
  'fork-rng-by-name' |
  'scoped-root' |
  'no-state-write-in-update' |
  'sync-lifecycle' |
  'dom-free-assets',
  PluginRule
>

/** Shipped configs. `recommended` turns every rule on at its catalogue severity. */
type ConfigsType = { recommended: FlatConfig[] }

export declare const configs: ConfigsType

type PluginType = {
  meta:    { name: string, version: string }
  rules:   typeof rules
  configs: typeof configs
}

declare const plugin: PluginType

export default plugin

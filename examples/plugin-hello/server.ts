import type { ServerPlugin } from '@coglet/logsafe-plugin-sdk/server'

const plugin: ServerPlugin = {
  matchType: (e) => (e.ns.startsWith('hello:') ? 'hello' : null),
}

export default plugin

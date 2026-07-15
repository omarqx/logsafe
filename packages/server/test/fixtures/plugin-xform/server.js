/** @type {import('@coglet/logsafe-plugin-sdk/server').ServerPlugin} */
const plugin = {
  matchType: (e) => (e.source === 'xform' ? 'xform' : null),
  transform: (e) => ({
    ...e,
    ns: 'xform:normalized',
    ctx: { ...(e.ctx && typeof e.ctx === 'object' ? e.ctx : {}), enriched: true },
  }),
}
export default plugin

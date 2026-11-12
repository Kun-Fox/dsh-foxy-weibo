const assert = require('node:assert/strict')

async function main() {
  let clientModule
  const style = { setAttribute() {}, remove() {}, textContent: '' }
  globalThis.document = { createElement: () => style, head: { appendChild() {} } }
  globalThis.window = {
    __ModuleLoader__: {
      load({ id, factory }) {
        assert.equal(id, 'dsh-foxy-weibo')
        const react = {
          createElement: (...args) => args,
          useCallback: (fn) => fn,
          useEffect: () => {},
          useRef: (value) => ({ current: value }),
          useState: (value) => [value, () => {}],
        }
        clientModule = factory(() => react)
      },
    },
  }

  await import('../lib/client.js')
  assert.ok(clientModule)
  assert.equal(clientModule.name, 'dsh-foxy-weibo')
  assert.deepEqual(clientModule.inject, ['slots'])

  const registered = []
  const ctx = {
    effect: (fn) => fn(),
    slots: {
      inject(slot, callback) {
        callback()
      },
      register(spec) {
        registered.push(spec)
      },
    },
  }
  clientModule.apply(ctx)
  assert.equal(registered.length, 2)
  assert.deepEqual(registered.map((x) => x.name), ['main', 'settings.section'])
  assert.equal(registered[0].key, 'dsh-foxy-weibo')
  assert.equal(registered[1].id, 'foxy-weibo')
  const page = globalThis.window.__FOXY_CONSOLE__.pages.find((item) => item.id === 'dsh-foxy-weibo')
  assert.ok(page)
  assert.equal(page.label, '微博')
  assert.equal(page.order, 14)
  console.log('foxy-weibo client tests passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

/**
 * Activation and behaviour checks for the client half, runnable in Node without a browser.
 *
 * Why this exists: a client bundle whose `apply()` throws does not merely lose its own features —
 * the Web boot counts a failed entry as fatal and refuses to mount the application, so the window
 * opens and stays empty. That failure mode cost one debugging round already, so every change to
 * `client.js` should be re-checked with:
 *
 *     node tools/behaviour-check.mjs [path/to/client.js]
 *
 * The harness evaluates the real bundle, activates the real plugin against a stub client context,
 * renders both registered components, then drives real Ctrl+wheel and Ctrl+key events.
 *
 * It deliberately provides NO `styles` binding: an installed client bundle has no `styles` builtin
 * (that symbol belongs to the dynamic package runner), so a bundle that reaches for it must fail
 * here exactly as it fails in the page.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const BUNDLE = process.argv[2] ?? join(here, '..', 'client.js')

const failures = []
const check = (label, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) failures.push(label)
}

// ---------- DOM ----------
const headChildren = []
function makeElement(tag) {
  return {
    tagName: tag,
    dataset: {},
    style: {
      values: new Map(),
      setProperty(k, v) { this.values.set(k, v) },
      removeProperty(k) { this.values.delete(k) },
      getPropertyValue(k) { return this.values.get(k) ?? '' },
    },
    children: [],
    append(child) { this.children.push(child) },
    appendChild(child) { this.children.push(child); return child },
    remove() {},
    addEventListener() {},
    removeEventListener() {},
    get clientWidth() { return 1200 },
    get scrollWidth() { return 1500 },
    scrollTop: 0,
    scrollLeft: 0,
  }
}
const documentElement = makeElement('html')
const head = makeElement('head')
globalThis.document = { documentElement, head, createElement: makeElement, querySelector: () => null }
const winListeners = new Map()
globalThis.window = {
  localStorage: {
    store: new Map(),
    getItem(k) { return this.store.get(k) ?? null },
    setItem(k, v) { this.store.set(k, String(v)) },
    removeItem(k) { this.store.delete(k) },
  },
  addEventListener(type, fn) { winListeners.set(type, fn) },
  removeEventListener() {},
}
globalThis.performance = { now: () => 1000 }

// ---------- React ----------
let hookSlots = []
let hookIndex = 0
const React = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props ?? {}), children: children.length ? (children.length === 1 ? children[0] : children) : undefined } }
  },
  useState(initial) {
    const i = hookIndex++
    if (!(i in hookSlots)) hookSlots[i] = typeof initial === 'function' ? initial() : initial
    const set = (next) => { hookSlots[i] = typeof next === 'function' ? next(hookSlots[i]) : next }
    return [hookSlots[i], set]
  },
  useEffect() {},
  useSyncExternalStore(subscribe, getSnapshot) {
    const i = hookIndex++
    if (!(i in hookSlots)) hookSlots[i] = getSnapshot()
    return hookSlots[i]
  },
  useRef(v) { const i = hookIndex++; if (!(i in hookSlots)) hookSlots[i] = { current: v }; return hookSlots[i] },
  useId: () => 'r0',
}
function render(component, props) {
  hookSlots = []
  hookIndex = 0
  return component(props)
}
function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props?.children)
}

// ---------- store engine (mirrors @deepseek-ai/dsh-client-store defineStore) ----------
function defineStore(decl) {
  return {
    spec: decl,
    create() {
      let state = decl.init()
      const subs = new Set()
      const actions = {}
      for (const key of Object.keys(decl.actions)) {
        actions[key] = (...params) => {
          const draft = { ...state }
          decl.actions[key](draft, ...params)
          state = draft
          for (const fn of [...subs]) fn()
        }
      }
      return {
        actions,
        getSnapshot: () => state,
        subscribe(fn) { subs.add(fn); return () => subs.delete(fn) },
        clearPersisted() {},
      }
    },
  }
}

// ---------- load the bundle ----------
let captured
globalThis.window.__ModuleLoader__ = { load(definition) { captured = definition } }
new Function(readFileSync(BUNDLE, 'utf8'))()
check('bundle registers a module factory', Boolean(captured))

const created = new Set()
const storeModule = {
  defineStore(decl) {
    const handle = defineStore(decl)
    return {
      spec: handle.spec,
      create(...args) {
        const instance = handle.create(...args)
        created.add(instance)
        return instance
      },
    }
  },
}
const sharedInstance = () => [...created][0]

const exportsObject = captured.factory((id) => {
  if (id === 'react') return React
  if (id === '@deepseek-ai/dsh-client-store') return storeModule
  throw new Error(`unexpected require("${id}")`)
})

// ---------- activate against a stub client context ----------
const registrations = []
const ctx = {
  fiber: { inject: { slots: true, locale: true } },
  effect(callback) { const d = callback(); return typeof d === 'function' ? d : () => {} },
  on: () => () => {},
  get: () => undefined,
  provide() { return () => {} },
  locale: { register: () => () => {} },
  slots: {
    inject: (key, callback) => { callback(); return () => {} },
    register: (options, component) => { registrations.push({ options, component }); return () => {} },
  },
}
const result = exportsObject.apply(ctx)
if (result && typeof result.then === 'function') await result
check('apply() completes without throwing', true)
check('two slot entries registered', registrations.length === 2, registrations.map((r) => r.options.id).join(', '))

const chip = registrations.find((r) => r.options.id === 'ctrl-wheel-zoom-chip')
const row = registrations.find((r) => r.options.id === 'ctrl-wheel-zoom')
check('chip lands in shell.overlay', chip?.options.name === 'shell.overlay')
check('row lands in settings.general.item', row?.options.name === 'settings.general.item')

// ---------- what the renderer would supply ----------
function kitFor(entry) {
  const instance = sharedInstance()
  const injected = entry.options.inject()
  return {
    ...injected,
    actions: injected.actions ?? {},
    t: (key, params) => {
      const dict = {
        'chip.percent': '{percent}%', 'chip.title': 'Page zoom {percent}%', 'chip.label': 'Page zoom',
        'chip.fit': 'Fit to width', 'fit.title': 'Fit to width', 'row.title': 'Page zoom',
        'row.description': 'hold ctrl', 'row.increase': '+', 'row.decrease': '-', 'row.reset': 'Reset', 'row.unit': '%',
      }
      let out = dict[key] ?? key
      for (const [k, v] of Object.entries(params ?? {})) out = out.replace(`{${k}}`, String(v))
      return out
    },
    useStore: (selector) => selector(instance.getSnapshot()),
  }
}
const chipKit = kitFor(chip)
check('chip renders nothing at 100%', render(chip.component, chipKit) === null)

// ---------- Ctrl + wheel ----------
const onWheel = winListeners.get('wheel')
check('wheel listener attached', typeof onWheel === 'function')
let prevented = 0
const wheel = (deltaY, timeStamp) => onWheel({
  ctrlKey: true, metaKey: false, deltaY, timeStamp,
  clientX: 600, clientY: 400, defaultPrevented: false,
  preventDefault() { prevented++ },
})
wheel(-120, 1000)
check('Ctrl+wheel applies zoom to <html>', documentElement.style.getPropertyValue('zoom') === '1.1', `zoom=${JSON.stringify(documentElement.style.getPropertyValue('zoom'))}`)
check('the gesture is prevented', prevented === 1)
wheel(-120, 1100)
check('another notch steps again', documentElement.style.getPropertyValue('zoom') === '1.2')
wheel(120, 1200)
check('wheel down steps back', documentElement.style.getPropertyValue('zoom') === '1.1')

const before = documentElement.style.getPropertyValue('zoom')
onWheel({ ctrlKey: false, metaKey: false, deltaY: -120, timeStamp: 1300, clientX: 0, clientY: 0, defaultPrevented: false, preventDefault() {} })
check('plain wheel does not zoom', documentElement.style.getPropertyValue('zoom') === before)

// ---------- keyboard ----------
const onKeydown = winListeners.get('keydown')
onKeydown({ key: '0', ctrlKey: true, metaKey: false, altKey: false, isComposing: false, defaultPrevented: false, preventDefault() {} })
check('Ctrl+0 resets to 100%', documentElement.style.getPropertyValue('zoom') === '')
onKeydown({ key: '=', ctrlKey: true, metaKey: false, altKey: false, isComposing: false, defaultPrevented: false, preventDefault() {} })
check('Ctrl+= zooms in', documentElement.style.getPropertyValue('zoom') === '1.1')
check('level is remembered', globalThis.window.localStorage.getItem('dsh.ctrl-wheel-zoom.value') === '110')

// ---------- both surfaces render ----------
const chipNode = render(chip.component, chipKit)
check('chip renders while zoomed', chipNode !== null)
check('chip shows the percentage', textOf(chipNode).includes('%'), JSON.stringify(textOf(chipNode)))
const rowNode = render(row.component, { ...kitFor(row), setZoom: () => {} })
check('settings row renders', rowNode !== null && textOf(rowNode).length > 0, JSON.stringify(textOf(rowNode)))

console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} CHECK(S) FAILED`}  (bundle: ${BUNDLE})`)
process.exitCode = failures.length === 0 ? 0 : 1

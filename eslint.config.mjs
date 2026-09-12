// One rule, and the bug it exists to catch.
//
// `/api/admin/dispatch/sheet` spent days answering every .xlsx and every BOL
// upload with "s is not defined". Two PRs collided: one renamed the session
// variable out from under a call site, the other added a call site using the
// old name. It is an ES module, so referencing a name nothing declares is a
// hard ReferenceError — thrown, caught by the route's own try, and returned to
// the dispatcher as if their spreadsheet were at fault.
//
// Nothing in the toolchain could have said so. This is plain JavaScript with no
// TypeScript, and Next 16 removed `next lint` and no longer runs ESLint during
// `next build` — so a free variable reached production and stayed there.
//
// So: `no-undef`, and deliberately nothing else. This is not a style pass and
// must not become one. A config that also argues about hooks, imports and
// unused variables is a config somebody turns off, and the one rule that would
// have caught a live outage goes with it.
//
// SELF-CONTAINED ON PURPOSE — no `globals` package, no `eslint-config-next`.
// Every dependency here would have to go in package.json, and package-lock.json
// cannot be regenerated without npm; a devDependency missing from the lockfile
// makes `npm ci` fail outright, which is what Vercel builds with and what the
// nightly catalog sync runs. A lint rule must not be able to break a deploy.
// `npx --yes eslint@9 .` therefore works with nothing installed.
//
// The globals below are deliberately GENEROUS. An over-broad list only means a
// stray reference to something like `status` goes unreported; a MISSING entry
// means a false failure on correct code, which is how a red build gets ignored.
// Anything absent shows up as a CI error naming the exact identifier — a
// one-line fix here, never a mystery.
const browser = [
  'window', 'document', 'navigator', 'location', 'history', 'screen', 'console',
  'fetch', 'Request', 'Response', 'Headers', 'FormData', 'Blob', 'File', 'FileReader',
  'URL', 'URLSearchParams', 'AbortController', 'AbortSignal',
  'Event', 'CustomEvent', 'EventTarget', 'MessageEvent', 'PopStateEvent',
  'localStorage', 'sessionStorage', 'indexedDB', 'IDBKeyRange', 'IDBRequest',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
  'structuredClone', 'reportError', 'alert', 'confirm', 'prompt', 'btoa', 'atob',
  'crypto', 'performance', 'matchMedia', 'getComputedStyle', 'scrollTo', 'scrollBy',
  'Image', 'Audio', 'Option', 'Notification', 'Worker', 'WebSocket', 'EventSource',
  'XMLHttpRequest', 'IntersectionObserver', 'ResizeObserver', 'MutationObserver',
  'DOMException', 'DOMParser', 'XMLSerializer', 'NodeFilter',
  'createImageBitmap', 'ImageBitmap', 'OffscreenCanvas', 'ImageData',
  'HTMLElement', 'HTMLCanvasElement', 'HTMLImageElement', 'HTMLInputElement',
  'Element', 'Node', 'NodeList', 'DocumentFragment', 'CanvasRenderingContext2D',
  'TextEncoder', 'TextDecoder', 'ReadableStream', 'WritableStream', 'TransformStream',
  'BroadcastChannel', 'MessageChannel', 'MessagePort', 'WakeLock',
  'getSelection', 'print', 'open', 'close', 'focus', 'blur', 'name', 'top', 'parent',
  'self', 'origin', 'status', 'length', 'frames', 'devicePixelRatio', 'isSecureContext'
];

const node = [
  'process', 'Buffer', 'global', 'globalThis', '__dirname', '__filename',
  'require', 'module', 'exports', 'setImmediate', 'clearImmediate', 'URLPattern'
];

// public/driver-sw.js — the driver PWA's service worker.
const serviceWorker = ['caches', 'clients', 'skipWaiting', 'registration', 'ServiceWorkerGlobalScope'];

const readonly = (names) => Object.fromEntries(names.map((n) => [n, 'readonly']));

export default [
  {
    // .next is generated, data/ is JSON the tracker writes, node_modules is not ours.
    ignores: ['.next/**', 'out/**', 'node_modules/**', 'data/**', 'coverage/**']
  },
  {
    // .jsx is listed explicitly: flat config only walks a directory for the
    // extensions some config block actually claims, and the components are jsx.
    files: ['**/*.js', '**/*.jsx', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...readonly(browser), ...readonly(node), ...readonly(serviceWorker) }
    },
    rules: { 'no-undef': 'error' }
  }
];

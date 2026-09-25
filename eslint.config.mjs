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

// PLACEHOLDER PLUGINS — rules that exist and never report.
//
// The repo carries `eslint-disable` comments for Next's and React's lint rules
// (`@next/next/no-img-element` on every deliberate <img>, `react/no-danger`,
// `react-hooks/exhaustive-deps`), written back when `next lint` ran them.
// ESLint 9 treats a comment naming a rule it has never heard of as an ERROR —
// "Definition for rule ... was not found" — so without these, the first run
// failed ten times on correct code and not once on the bug this file is for.
//
// Loading the real plugins would mean devDependencies and a lockfile change
// (see above), and would switch on rules this config deliberately doesn't run.
// So each is a name and nothing else: enough for a disable comment to resolve,
// never enabled, never able to report. The lists are generous for the same
// reason the globals are: a missing name is a red build on correct code.
const silent = { meta: { type: 'problem', schema: false }, create: () => ({}) };
const plugin = (names) => ({ rules: Object.fromEntries(names.map((n) => [n, silent])) });

const placeholders = {
  '@next/next': plugin([
    'no-img-element', 'no-html-link-for-pages', 'no-sync-scripts', 'no-page-custom-font',
    'google-font-display', 'google-font-preconnect', 'inline-script-id', 'next-script-for-ga',
    'no-assign-module-variable', 'no-async-client-component', 'no-before-interactive-script-outside-document',
    'no-css-tags', 'no-document-import-in-page', 'no-duplicate-head', 'no-head-element',
    'no-head-import-in-document', 'no-script-component-in-head', 'no-styled-jsx-in-document',
    'no-title-in-document-head', 'no-typos', 'no-unwanted-polyfillio'
  ]),
  react: plugin([
    'no-danger', 'no-danger-with-children', 'no-unescaped-entities', 'no-unknown-property',
    'no-array-index-key', 'no-children-prop', 'jsx-key', 'jsx-no-target-blank',
    'display-name', 'prop-types', 'react-in-jsx-scope'
  ]),
  'react-hooks': plugin(['rules-of-hooks', 'exhaustive-deps'])
};

export default [
  {
    // .next is generated, data/ is JSON the tracker writes, node_modules is not ours.
    //
    // The `**/` prefixes matter. A bare `.next/**` anchors at the repo root, so
    // a build output nested anywhere else — a git worktree under .claude/, a
    // `.vercel/output` from the CLI — was linted as source and buried the real
    // findings under a hundred `'trustedTypes' is not defined` from minified
    // chunks. CI never saw it (fresh checkout, none of those directories exist)
    // and every local run did, which is the wrong way round: the person who can
    // act on a finding is the one whose output is noise.
    ignores: [
      '**/.next/**', '**/out/**', '**/node_modules/**', '**/coverage/**',
      '.vercel/**', '.claude/**', 'data/**'
    ]
  },
  {
    // .jsx is listed explicitly: flat config only walks a directory for the
    // extensions some config block actually claims, and the components are jsx.
    files: ['**/*.js', '**/*.jsx', '**/*.mjs'],
    // Off, not warn: a bare `/* eslint-disable-next-line */` guarding a
    // useEffect, or one naming a rule this config doesn't run, is "unused" by
    // definition here. Seven warnings about rules nobody is running is noise
    // that teaches people to scroll past the output.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    plugins: placeholders,
    languageOptions: {
      // 'latest', not a year: import attributes (`with { type: 'json' }`) need
      // it, and a parse error fails the run exactly like a real finding.
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...readonly(browser), ...readonly(node), ...readonly(serviceWorker) }
    },
    rules: { 'no-undef': 'error' }
  }
];

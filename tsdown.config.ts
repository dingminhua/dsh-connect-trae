import { readFileSync } from 'node:fs'
import type { UserConfig } from 'tsdown'

const PLUGIN_ID = 'dsh-connect-trae'

const CLIENT_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  // react-dom MUST stay external. It is registered by the shell's module loader
  // (`staticModules`), so externalizing turns the import into a `require` the
  // page resolves. BUNDLING it inlines both the development and production CJS
  // builds, and every one of them opens with
  //   if (process.env.NODE_ENV !== "production") …
  // which throws `ReferenceError: process is not defined` in the browser — at
  // module-evaluation time, so the ENTIRE client half fails to import:
  //   web boot: 1 entry did not activate
  //   dsh-connect-trae: import failed
  // That is exactly what shipped in 2.12.0 and 2.13.0 (the credit panel needed
  // `createPortal`). `tests/client-runtime-imports.spec.ts` now pins this.
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-renderer/client',
  '@deepseek-ai/dsh-client-ui-settings/client',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-locale/client',
  '@deepseek-ai/dsh-client-ui-settings-plugins/client',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

export default [
  {
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
    deps: {
      neverBundle: [
        '@earendil-works/pi-ai',
        '@deepseek-ai/schemastery',
        '@deepseek-ai/cordis',
        '@deepseek-ai/dsh-atomic-write',
        '@deepseek-ai/dsh-attachment',
        '@deepseek-ai/dsh-home-paths',
        '@deepseek-ai/dsh-host-webserver',
        '@deepseek-ai/dsh-llm',
        '@deepseek-ai/dsh-llm-pi-ai',
        '@deepseek-ai/dsh-settings',
      ],
    },
  },
  {
    entry: { client: 'src/client/index.tsx' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    clean: false,
    deps: { neverBundle: [...CLIENT_EXTERNALS] },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]

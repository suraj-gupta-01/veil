import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'VEIL',
    description: 'Privacy-preserving browser vision agent. Reads the screen locally and sends only redacted context.',
    permissions: ['tabs', 'storage', 'scripting', ...(browser === 'firefox' ? [] : ['sidePanel', 'offscreen'])],
    host_permissions: ['<all_urls>'],
    // ONNX Runtime compiles WebAssembly; models and runtime files ship inside the extension.
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" },
    action: { default_title: 'Open VEIL' },
    commands: {
      'stop-agent': { suggested_key: { default: 'Alt+Shift+Period' }, description: 'Stop VEIL and wipe the vault' },
    },
    ...(browser === 'firefox'
      ? { browser_specific_settings: { gecko: { id: 'veil@rvce.dev', strict_min_version: '128.0' } } }
      : {}),
  }),
});

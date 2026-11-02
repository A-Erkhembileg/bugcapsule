import { defineManifest } from '@crxjs/vite-plugin';
import project from './package.json' with { type: 'json' };

const icons = {
  16: 'icons/capsule-16.png',
  32: 'icons/capsule-32.png',
  48: 'icons/capsule-48.png',
  128: 'icons/capsule-128.png',
};

export default defineManifest({
  manifest_version: 3,
  name: 'BugCapsule',
  version: project.version,
  description: 'Capture bugs. Share context. Reproduce faster. Privacy-first, local bug reports.',
  minimum_chrome_version: '120',
  permissions: ['activeTab', 'scripting', 'storage'],
  optional_host_permissions: ['https://generativelanguage.googleapis.com/*'],
  icons,
  action: {
    default_popup: 'index.html',
    default_title: 'BugCapsule — capture a bug',
    default_icon: icons,
  },
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  commands: {
    _execute_action: { suggested_key: { default: 'Alt+Shift+B' }, description: 'Open BugCapsule' },
  },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'; connect-src https://generativelanguage.googleapis.com",
  },
});

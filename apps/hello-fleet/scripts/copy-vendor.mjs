#!/usr/bin/env node
// Copies vendored client assets from node_modules into public/vendor/
// (gitignored, rebuilt by build:client). Everything the browser loads is
// self-hosted — no third-party CDNs (charter §2.6).
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const appDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(appDir, 'public', 'vendor');
const pkgDir = (name, probe) => path.dirname(require.resolve(`${name}/${probe}`));

// HTMX
mkdirSync(vendorDir, { recursive: true });
cpSync(
  path.join(pkgDir('htmx.org', 'dist/htmx.min.js'), 'htmx.min.js'),
  path.join(vendorDir, 'htmx.min.js'),
);

// Lucide icon font (loaded by default in layout.eta — .icon-<name> classes)
const lucideFont = pkgDir('lucide-static', 'font/lucide.css');
mkdirSync(path.join(vendorDir, 'lucide'), { recursive: true });
for (const file of ['lucide.css', 'lucide.woff2', 'lucide.woff', 'lucide.ttf', 'lucide.eot', 'lucide.svg']) {
  cpSync(path.join(lucideFont, file), path.join(vendorDir, 'lucide', file));
}

// Font Awesome Free (vendored but opt-in per app — fa-solid/fa-regular/fa-brands)
const faDir = path.join(pkgDir('@fortawesome/fontawesome-free', 'css/all.min.css'), '..');
mkdirSync(path.join(vendorDir, 'fontawesome', 'css'), { recursive: true });
cpSync(path.join(faDir, 'css', 'all.min.css'), path.join(vendorDir, 'fontawesome', 'css', 'all.min.css'));
cpSync(path.join(faDir, 'webfonts'), path.join(vendorDir, 'fontawesome', 'webfonts'), { recursive: true });

console.log('vendor assets copied: htmx, lucide, fontawesome');

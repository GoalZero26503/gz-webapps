// Content-hash the app-owned static assets into immutable filenames + a manifest.
//
// Why filenames (not a ?v= query): the page is served by a fleet of Lambda
// instances behind CloudFront. With a STABLE filename + a query, an old instance
// during a rolling deploy can answer a request for the new ?v= URL with its OLD
// bytes (static serving ignores the query), and CloudFront caches those bytes
// under the new key — pinned forever if `immutable`. A hashed FILENAME removes
// that race: an old instance simply doesn't have `app.<newhash>.js` (404, never
// wrong bytes), and changing the filename also busts every previously-cached copy.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const PUBLIC = path.join(process.cwd(), 'public');
const hash = (buf) => createHash('sha1').update(buf).digest('hex').slice(0, 10);

// logical path (as referenced in templates) → file on disk
const ASSETS = [
  ['/assets/app.js', path.join(PUBLIC, 'assets', 'app.js')],
  ['/styles.css', path.join(PUBLIC, 'styles.css')],
];

const manifest = {};
for (const [logical, file] of ASSETS) {
  const dir = path.dirname(file);
  const ext = path.extname(file);
  const base = path.basename(file, ext);
  // Clear stale hashed copies from a previous build so they don't accumulate.
  for (const f of readdirSync(dir)) {
    if (new RegExp(`^${base}\\.[0-9a-f]{10}${ext.replace('.', '\\.')}$`).test(f)) unlinkSync(path.join(dir, f));
  }
  const buf = readFileSync(file);
  const hashedName = `${base}.${hash(buf)}${ext}`;
  writeFileSync(path.join(dir, hashedName), buf);
  manifest[logical] = `/${path.relative(PUBLIC, path.join(dir, hashedName)).replace(/\\/g, '/')}`;
}

writeFileSync(path.join(PUBLIC, 'assets', 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('hashed assets:', manifest);

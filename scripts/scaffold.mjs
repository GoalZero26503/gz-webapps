#!/usr/bin/env node
// Scaffold a new app from apps/_template (charter §4.3).
//
// Usage (normally invoked by the in-repo LLM after the scaffolding
// conversation — see .claude/commands/gz:webapp:new-app.md):
//
//   pnpm scaffold <app-name> \
//     --display "Lab Data Viewer" \
//     --owner gh-handle \
//     --admin person@goalzero.com
//
// <app-name> is kebab-case and becomes the directory, AWS resource infix,
// and default subdomain. Run scripts/random-slug.sh for a playful default.

import { cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      args[argv[i].slice(2)] = argv[++i];
    } else {
      args._.push(argv[i]);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const appName = args._[0];
if (!appName) fail('app name required: pnpm scaffold <app-name> --display "..." --owner <gh-handle> --admin <email>');
if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(appName)) fail(`app name must be kebab-case, got: ${appName}`);
if (appName.startsWith('_')) fail('underscore-prefixed names are reserved for skeletons');

const display = args.display || appName.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const owner = args.owner || null;
const admin = args.admin || null;
const pascal = appName.replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());

const templateDir = path.join(repoRoot, 'apps', '_template');
const targetDir = path.join(repoRoot, 'apps', appName);
if (existsSync(targetDir)) fail(`apps/${appName} already exists`);

const SKIP = new Set(['node_modules', 'dist', 'cdk.out', '.env']);
const GENERATED = ['public/assets', 'public/vendor'];

cpSync(templateDir, targetDir, {
  recursive: true,
  filter: (src) => {
    const rel = path.relative(templateDir, src);
    if (rel.split(path.sep).some((part) => SKIP.has(part))) return false;
    if (GENERATED.some((g) => rel.startsWith(g.replace('/', path.sep)))) return false;
    return true;
  },
});

const replacements = {
  '{{APP_NAME}}': appName,
  '{{APP_NAME_PASCAL}}': pascal,
  '{{APP_DISPLAY_NAME}}': display,
  '{{SEED_ADMIN_EMAIL}}': admin ?? '{{SEED_ADMIN_EMAIL}}',
  'gzweb-app-template': appName,
};

function substitute(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      substitute(full);
      continue;
    }
    if (/\.(png|ico|jpg|woff2?)$/.test(entry)) continue;
    let content = readFileSync(full, 'utf-8');
    let changed = false;
    for (const [from, to] of Object.entries(replacements)) {
      if (content.includes(from)) {
        content = content.replaceAll(from, to);
        changed = true;
      }
    }
    if (changed) writeFileSync(full, content);
  }
}
substitute(targetDir);

if (owner) {
  appendFileSync(
    path.join(repoRoot, '.github', 'CODEOWNERS'),
    `apps/${appName}/ @${owner.replace(/^@/, '')} @GoalZero26503/webapp-gatekeepers\n`,
  );
}

console.log(`Scaffolded apps/${appName} ("${display}")`);
console.log('');
console.log('Next steps:');
console.log(`  1. pnpm install                      # link the new workspace package`);
if (!admin) console.log(`  2. Replace {{SEED_ADMIN_EMAIL}} in apps/${appName}/ (no --admin given)`);
if (!owner) console.log(`  2. Add the owner to .github/CODEOWNERS (no --owner given)`);
console.log(`  3. Fill in the "why this stack" note in apps/${appName}/README.md and .claude/CLAUDE.md`);
console.log(`  4. Commit on a branch and open a PR — the gatekeeper review admits the app to the fleet`);
console.log(`  5. After merge, create the app's GitHub Environment + deploy role (docs/setup.md)`);

// Lockstep versions: every package carries the root version, and every
// dependency on a sibling package pins that same version. `npm version
// --workspaces` bumps the packages but never rewrites the ranges between
// them, so this runs after each bump.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = JSON.parse(readFileSync('package.json', 'utf8'));
const dir = 'packages';
const names = new Set();
const manifests = [];
for (const entry of readdirSync(dir)) {
  const file = join(dir, entry, 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf8'));
    names.add(pkg.name);
    manifests.push({ file, pkg });
  } catch { /* not a package */ }
}
for (const { file, pkg } of manifests) {
  pkg.version = root.version;
  for (const field of ['dependencies', 'peerDependencies']) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      if (names.has(dep)) pkg[field][dep] = root.version;
    }
  }
  writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
}
console.log(`synced ${manifests.length} packages to ${root.version}`);

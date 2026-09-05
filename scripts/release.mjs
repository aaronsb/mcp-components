// Bump every package and the root together, commit, tag, push. The tag push
// is what triggers npm-publish.yml, which publishes all workspaces at once.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const level = process.argv[2];
if (!['patch', 'minor', 'major'].includes(level)) {
  console.error('usage: release.mjs patch|minor|major');
  process.exit(1);
}
const run = (cmd) => { console.log(`$ ${cmd}`); execSync(cmd, { stdio: 'inherit' }); };

const status = execSync('git status --porcelain').toString().trim();
if (status) {
  console.error('working tree is not clean');
  process.exit(1);
}
run('npm run lint');
run('npm run type-check');
run('npm test');
run('npm run build');
run(`npm version ${level} --no-git-tag-version`);
run('npm run version:sync');
run('npm install --package-lock-only');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
run('git add -A');
run(`git commit -m "chore: release v${version}"`);
run(`git tag v${version}`);
run('git push && git push --tags');

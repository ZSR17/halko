// Publishes a version: `npm run release -- minor` (new features), `patch` (fixes only) or `major` (updating
// an installation needs a step by hand). Master only takes pull requests: the version is prepared on a
// release/<version> branch, merged once its CI has passed, then tagged on master. GitHub then builds the
// Docker image and the release (.github/workflows).
import { execSync } from 'node:child_process';
import { CHANGELOGS, read, section, write } from './changelog.mjs';

const run = (cmd) => execSync(cmd, { stdio: 'inherit' });
const out = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
// Failed or cancelled checks of the pull request (none until GitHub has registered them).
const failedChecks = (branch) => {
  try {
    return out(`gh pr checks ${branch} --json bucket -q "[.[] | select(.bucket == \\"fail\\" or .bucket == \\"cancel\\")] | length"`);
  } catch {
    return '0';
  }
};
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const kind = process.argv[2];
if (!['major', 'minor', 'patch'].includes(kind)) fail('Usage: npm run release -- minor|patch|major');
if (out('git branch --show-current') !== 'master') fail('Releases are made from master.');
if (out('git status --porcelain')) fail('Commit or put aside the changes first.');
run('git pull --ff-only');
for (const c of CHANGELOGS) {
  if (!section(read(c.file), c.unreleased)) fail(`${c.file}: "${c.unreleased}" is empty, nothing to release.`);
}

const [major, minor, patch] = JSON.parse(read('package.json')).version.split('.').map(Number);
const version = { major: `${major + 1}.0.0`, minor: `${major}.${minor + 1}.0`, patch: `${major}.${minor}.${patch + 1}` }[kind];
const branch = `release/${version}`;

run('npm run typecheck');
run('npm test');

run(`git switch -c ${branch}`);
run(`npm version ${version} --workspaces --include-workspace-root --no-git-tag-version`);
const date = new Date().toISOString().slice(0, 10);
for (const c of CHANGELOGS) {
  write(c.file, read(c.file).replace(`${c.unreleased}\n`, `${c.unreleased}\n\n## ${version} — ${date}\n`));
}
run('git add -A');
run(`git commit -m "Release ${version}"`);
run(`git push -u origin ${branch}`);
run(`gh pr create --base master --head ${branch} --title "Release ${version}" --body "Halko ${version}: see the changelog."`);

// Its checks take a few seconds to show up, then the CI a few minutes (the arm/v7 image is emulated).
console.log('\nWaiting for the CI of the pull request...');
for (let i = 0; ; i++) {
  try {
    run(`gh pr checks ${branch} --watch --interval 30 --fail-fast`);
    break;
  } catch {
    if (i >= 12 || failedChecks(branch) !== '0') {
      fail(`The CI failed: nothing is published. The pull request stays open: gh pr view ${branch} --web`);
    }
    execSync('node -e "setTimeout(() => {}, 10000)"');
  }
}

run(`gh pr merge ${branch} --squash --delete-branch --subject "Release ${version}"`);
run('git switch master');
run('git pull --ff-only');
if (out('git log -1 --format=%s') !== `Release ${version}`) fail('Master does not end with the release commit: tag it by hand.');
run(`git tag -a v${version} -m "Halko ${version}"`);
run(`git push origin v${version}`);
console.log(`\nHalko ${version} is on its way: https://github.com/ZSR17/halko/actions`);

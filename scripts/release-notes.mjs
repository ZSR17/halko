// Notes of the GitHub release of a version: its changelog sections, in English then in French.
//   node scripts/release-notes.mjs 0.2.0
import { CHANGELOGS, read, section } from './changelog.mjs';

const version = process.argv[2];
const parts = CHANGELOGS.map((c) => {
  const heading = read(c.file).match(new RegExp(`^## ${version.replaceAll('.', '\.')} — .*$`, 'm'))?.[0];
  const text = heading && section(read(c.file), heading);
  if (!text) throw new Error(`${c.file}: no section for ${version}`);
  return `### ${c.language}\n\n${text}`;
});
console.log(parts.join('\n\n'));

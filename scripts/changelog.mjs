// The two changelogs (English and French), read and written by the release scripts.
import fs from 'node:fs';

export const CHANGELOGS = [
  { file: 'CHANGELOG.md', unreleased: '## Unreleased', language: 'English' },
  { file: 'CHANGELOG.fr.md', unreleased: '## Pas encore publié', language: 'Français' },
];

// The text of a section: what follows its heading, up to the next one.
export function section(text, heading) {
  const start = text.indexOf(`${heading}\n`);
  if (start < 0) return null;
  const body = text.slice(start + heading.length + 1);
  const end = body.search(/^## /m);
  return (end < 0 ? body : body.slice(0, end)).trim();
}

export const read = (file) => fs.readFileSync(file, 'utf8');
export const write = (file, text) => fs.writeFileSync(file, text);

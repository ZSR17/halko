// Usage: npm run hash-password                     (asks for the password, hidden, twice)
//        npm run hash-password -- "<pw>"            (or pipe the password on stdin)
//        npm run hash-password -- --write <file>    (writes APP_PASSWORD_HASH to an env file, chmod 600)
// Prints the value to put in APP_PASSWORD_HASH.
import fs from 'node:fs';
import { hashPassword } from '../lib/password.ts';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8').trim();
}

// Reads one line from the terminal without echoing it.
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    process.stderr.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (key: string) => {
      for (const ch of key) {
        if (ch === '\r' || ch === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stderr.write('\n');
          return resolve(value);
        }
        if (ch === '\u0003') process.exit(130); // Ctrl+C
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

const args = process.argv.slice(2);
const writeAt = args.indexOf('--write');
const envFile = writeAt >= 0 ? args.splice(writeAt, 2)[1] : undefined;
let password = args[0] ?? '';
if (!password && process.stdin.isTTY) {
  password = await askHidden('App password: ');
  if (password !== (await askHidden('Confirm: '))) {
    console.error('The two entries differ.');
    process.exit(1);
  }
} else if (!password) {
  password = await readStdin();
}
if (password.length < 8) {
  console.error('Password too short (8 characters at least).');
  process.exit(1);
}
const hash = await hashPassword(password);
if (envFile) {
  // Single quotes: Docker Compose would otherwise read each "$..." of the hash as a variable.
  fs.writeFileSync(envFile, `APP_PASSWORD_HASH='${hash}'\nLOG_LEVEL=info\n`, { mode: 0o600 });
  fs.chmodSync(envFile, 0o600);
  console.error(`Written to ${envFile}`);
} else {
  console.log(hash);
}

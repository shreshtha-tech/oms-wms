import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

if (!process.stdin.isTTY || !process.stdin.setRawMode) {
  process.stderr.write('Run this command in an interactive terminal.\n');
  process.exit(1);
}

process.stdout.write('Administrator password: ');
process.stdin.setRawMode(true);
process.stdin.resume();
let password = '';
process.stdin.on('data', async chunk => {
  const key = chunk.toString('utf8');
  if (key === '\u0003') {
    process.stdout.write('\n');
    process.exit(130);
  }
  if (key === '\r' || key === '\n') {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write('\n');
    if (password.length < 12) {
      process.stderr.write('Use at least 12 characters.\n');
      process.exitCode = 1;
      return;
    }
    const salt = randomBytes(16).toString('hex');
    const hash = await promisify(scryptCallback)(password, salt, 64);
    password = '';
    process.stdout.write(`DMILLS_ADMIN_PASSWORD_HASH=${salt}:${hash.toString('hex')}\n`);
    return;
  }
  if (key === '\u007f') password = password.slice(0, -1);
  else password += key;
});

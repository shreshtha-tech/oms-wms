import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { ExpandArguments } from '../node_modules/concurrently/dist/src/command-parser/expand-arguments.js';
const require = createRequire(import.meta.url);
const { quote } = require('shell-quote');
assert.equal(require('shell-quote/package.json').version, '1.11.0');
for (const terminator of ['\n', '\r', '\u2028', '\u2029']) {
  assert.throws(() => quote([{ comment: 'fixture' }, `${terminator}printf INJECTED`]), TypeError);
}
const argumentsToPreserve = ['space value', "single'quote", 'double"quote', '$(printf INJECTED)', '`printf INJECTED`', 'line\nbreak', '; printf INJECTED', ''];
const base = quote([process.execPath, '-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '--']);
const command = new ExpandArguments(argumentsToPreserve).parse({ command: `${base} {@}` }).command;
const output = execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8', timeout: 2000, env: { PATH: '/usr/bin:/bin' } });
assert.deepEqual(JSON.parse(output), argumentsToPreserve);
assert.equal(new ExpandArguments(['space value']).parse({ command: 'tool {1} {9}' }).command, "tool 'space value' ");
console.log('PASS: patched quote rejects comment/newline injection; concurrently placeholders preserve adversarial arguments through a real shell.');

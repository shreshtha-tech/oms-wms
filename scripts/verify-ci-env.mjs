import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=await mkdtemp(join(tmpdir(),'oms-ci-dotenv-'));
try {
 await writeFile(join(root,'package.json'),'{"type":"module"}');
 await writeFile(join(root,'env.js'),await readFile(new URL('../env.js',import.meta.url),'utf8'));
 await symlink(new URL('../node_modules',import.meta.url).pathname,join(root,'node_modules'),'dir');
 await writeFile(join(root,'.env'),'OMS_CI_DOTENV_SENTINEL=synthetic-only\n');
 const run=skip=>spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(join(root,'env.js'))}); console.log(process.env.OMS_CI_DOTENV_SENTINEL || 'ABSENT')`],{env:{PATH:process.env.PATH,NODE_ENV:'test',...(skip?{DMILLS_SKIP_DOTENV:'true'}:{})},encoding:'utf8'});
 const skipped=run(true);assert.equal(skipped.status,0,skipped.stderr);assert.equal(skipped.stdout.trim(),'ABSENT');
 const normal=run(false);assert.equal(normal.status,0,normal.stderr);assert.match(normal.stdout,/synthetic-only/);
 console.log('PASS CI dotenv: explicit skip ignores synthetic .env; default loading preserved');
}finally{await rm(root,{recursive:true,force:true});}

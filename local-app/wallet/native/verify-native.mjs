// Offline verification only. No RPC, credentials, signer or broadcast capability.
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp, rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {resolve, join, relative, isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const binary=resolve(process.argv[2]||'');
const expected=process.argv[3];
assert(/^[a-f0-9]{64}$/.test(expected||''),'Provide the binary path and pinned SHA-256');
assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'),expected);
const reference=JSON.parse(await readFile(new URL('./selftest-reference.json',import.meta.url)));
const dir=await mkdtemp(join(tmpdir(),'ns-native-selftest-'));
try{
 const output=join(dir,'result.json');
 await promisify(execFile)(binary,[fileURLToPath(new URL('./selftest-input.json',import.meta.url)),output],{windowsHide:true,timeout:180000,maxBuffer:1048576});
 const result=JSON.parse(await readFile(output));
 assert.equal(result.passed,true);
 assert.equal(result.checks.length,reference.checks.length);
 assert(result.checks.every(c=>c.passed===true));
 assert.deepEqual(result.balances,reference.balances);
 assert.deepEqual(result.codes,reference.codes);
 assert.deepEqual(result.plans.map(p=>[p.name,p.gasUsed]),reference.plans.map(p=>[p.name,p.gasUsed]));
 const evidence={platform:process.platform,architecture:process.arch,binarySha256:expected,passed:true,checks:result.checks.length,balancesMatch:true,runtimeMatch:true,gasMatch:true,broadcasts:0};
 await writeFile(new URL('./selftest-'+process.platform+'-evidence.json',import.meta.url),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence));
}finally{
 const r=relative(resolve(tmpdir()),resolve(dir));
 assert(!isAbsolute(r)&&!r.startsWith('..')&&r.startsWith('ns-native-selftest-'));
 await rm(dir,{recursive:true,force:true});
}

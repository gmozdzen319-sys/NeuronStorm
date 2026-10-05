import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const native=process.argv.includes('--native');
if(native&&!process.env.NEURON_TEST_DATABASE_URL)throw Error('Set NEURON_TEST_DATABASE_URL to an isolated localhost PostgreSQL database, or use npm run test:postgres:embedded.');
const child=spawn(process.execPath,['--test','--test-concurrency=1','test/*.test.mjs'],{
 cwd:fileURLToPath(new URL('../',import.meta.url)),stdio:'inherit',windowsHide:true,
 env:{...process.env,DATABASE_URL:'',NEURON_TEST_PGLITE:native?'':'1'}});
process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});

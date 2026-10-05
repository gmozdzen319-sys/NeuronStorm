import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
const require=createRequire(import.meta.url);
const {default:getBinaries}=await import(new URL('./binary.js',pathToFileURL(require.resolve('embedded-postgres'))));
const binaries=await getBinaries();
const execute=promisify(execFile);
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';

// On Windows postgres can inherit pg_ctl's pipes. Waiting for pipe closure
// would then wait until the database itself stops, even though pg_ctl exited.
function control(args){
 return new Promise((resolve,reject)=>{
  const child=spawn(binaries.pg_ctl,args,{windowsHide:true,stdio:'ignore'});
  child.once('error',reject);
  child.once('exit',code=>code===0?resolve():reject(Error('PostgreSQL control failed (exit '+code+').')));
 });
}

// A real, disposable PostgreSQL server. Never reads the production DATABASE_URL.
const directory=await mkdtemp(join(tmpdir(),'neuron-storm-pg-test-'));
const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const password=randomBytes(24).toString('hex');
const cluster=join(directory,'cluster'),passwordFile=join(directory,'password');
await writeFile(passwordFile,password+'\n');
let started=false;
const postgres={async stop(){await control(['-D',cluster,'-m','fast','-w','-t','30','stop']);}};
try{
 console.log('[1/3] Preparing an isolated local PostgreSQL database...');
 await execute(binaries.initdb,['-D',cluster,'-U','postgres','--pwfile='+passwordFile,'-A','scram-sha-256','--locale=C','--encoding=UTF8'],{windowsHide:true,timeout:120000});
 console.log('[2/3] Starting PostgreSQL on localhost...');
 await control(['-D',cluster,'-l',join(directory,'postgres.log'),'-o','-h 127.0.0.1 -p '+port,'-w','-t','30','start']);
 started=true;
 console.log('[3/3] Running application tests...');
 console.log('Testing with disposable PostgreSQL 18 on localhost.');
 const args=process.argv.slice(2);
 const child=spawn(process.execPath,['--test','--test-concurrency=1',...(args.length?args:['test/*.test.mjs'])],{
  cwd:fileURLToPath(new URL('../',import.meta.url)),stdio:'inherit',windowsHide:true,
  env:{...process.env,DATABASE_URL:'',NEURON_TEST_PGLITE:'',NEURON_TEST_DATABASE_URL:`postgresql://postgres:${password}@127.0.0.1:${port}/postgres`}});
 process.exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
}finally{
 console.log('Stopping the local test database...');
 let stopped=false;
 try{await postgres.stop();stopped=true;}catch{if(started)console.error('Could not confirm PostgreSQL shutdown; its temporary files have been preserved:',directory);}
 // Delete only the exact temporary directory made above, after PostgreSQL stops.
 if(stopped&&relative(resolve(tmpdir()),resolve(directory)).startsWith('neuron-storm-pg-test-'))await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:300});
}

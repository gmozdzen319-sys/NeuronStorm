import pg from 'pg';
import {randomBytes} from 'node:crypto';
import {after} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {createServer} from 'node:net';
import {createApp as createProductionApp} from '../server.mjs';
export {ADMIN} from '../server.mjs';
const databases=new Map();
const created=new Set();
const engines=new Map();
after(async()=>{
 for(const {socket,engine} of engines.values()){await socket.stop();await engine.close();}
 if(created.size){const client=new pg.Client({connectionString:process.env.NEURON_TEST_DATABASE_URL});await client.connect();
  try{for(const name of created)if(/^ns_test_[a-f0-9]{24}$/.test(name))await client.query('DROP DATABASE '+name+' WITH (FORCE)');}finally{await client.end();}
 }
});
export async function createApp(options={}){
 if(process.env.NEURON_TEST_PGLITE==='1'){
  const key=options.database??':memory:';let instance=key===':memory:'?null:engines.get(key);
  if(!instance){
   const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
   const engine=await PGlite.create(),socket=new PGLiteSocketServer({db:engine,host:'127.0.0.1',port,maxConnections:20});await socket.start();
   instance={engine,socket,url:`postgresql://postgres:postgres@127.0.0.1:${port}/postgres`};
   if(key!==':memory:')engines.set(key,instance);
  }
  let app;
  try{app=await createProductionApp({...options,database:instance.url,databasePoolSize:1});}
  catch(error){if(key===':memory:'){await instance.socket.stop();await instance.engine.close();}throw error;}
  const close=app.db.close;let closed=false;
  app.db.close=async()=>{if(closed)return;closed=true;await close();if(key===':memory:'){await instance.socket.stop();await instance.engine.close();}};
  return app;
 }
 const connection=process.env.NEURON_TEST_DATABASE_URL;
 if(!connection)throw Error('Run tests with node test/run-postgres.mjs. Production databases are never used.');
 const url=new URL(connection);
 if(url.hostname!=='127.0.0.1')throw Error('Tests require the isolated local PostgreSQL server.');
 const key=options.database??':memory:';
 let database=key!==':memory:'?databases.get(key):null;
 if(!database){
  database='ns_test_'+randomBytes(12).toString('hex');
  const client=new pg.Client({connectionString:connection});await client.connect();
  try{await client.query('CREATE DATABASE '+database);created.add(database);}finally{await client.end();}
  if(key!==':memory:')databases.set(key,database);
 }
 url.pathname='/'+database;
 return createProductionApp({...options,database:url.href});
}

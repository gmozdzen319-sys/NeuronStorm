import { createApp } from './server.mjs';

const port = Number(process.env.PORT) || 3000;
const origin = process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + port;
try {
  const app = await createApp({origin});
  app.server.listen(port, '0.0.0.0', () => console.log('Neuron Storm: ' + origin + ' · PostgreSQL ready'));
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;await app.close();};
  process.once('SIGTERM',stop);
  process.once('SIGINT',stop);
} catch (error) {
  console.error('Neuron Storm could not start. Check DATABASE_URL and PostgreSQL availability. Error code:',error.code||'configuration');
  process.exitCode=1;
}

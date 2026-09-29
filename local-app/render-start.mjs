import { createApp } from './server.mjs';

const port = Number(process.env.PORT) || 3000;
const origin = process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + port;
const { server } = createApp({ origin });
server.listen(port, '0.0.0.0', () => console.log('Neuron Storm: ' + origin));

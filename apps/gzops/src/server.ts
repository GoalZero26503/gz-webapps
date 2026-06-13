import { loadConfig } from './config.js';

// Config (including SSM-backed secrets) loads before the server accepts
// traffic; the Lambda Web Adapter holds invocations until the port is open.
await loadConfig();

const { buildApp } = await import('./app.js');
const app = buildApp();

const port = Number(process.env.PORT || 3000);
await app.listen({ port, host: '0.0.0.0' });

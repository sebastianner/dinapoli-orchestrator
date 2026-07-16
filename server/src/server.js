import http from 'node:http';
import { createApp } from './app.js';
import { attachOrderSocket } from './ws/orderSocket.js';
import { startQueueWorker } from './services/queueService.js';

const PORT = process.env.PORT ?? 3000;

const app = createApp();
const server = http.createServer(app);

attachOrderSocket(server);
startQueueWorker();

server.listen(PORT, () => {
  console.log(`Dinapoli orchestrator listening on http://localhost:${PORT}`);
});

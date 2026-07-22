import type { Server as HttpServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { createOrder } from '../services/orderService.js';
import { notifyPrintQueue } from '../services/queueService.js';

const WS_PATH = '/ws/orders';

export function attachOrderSocket(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'connected', message: 'Send an OrderRequest JSON payload to place an order.' }));

    socket.on('message', (raw) => {
      let orderRequest: unknown;
      try {
        orderRequest = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'invalid JSON payload' }));
        return;
      }

      try {
        const order = createOrder(orderRequest);
        notifyPrintQueue();
        socket.send(JSON.stringify({ type: 'order_created', order }));
      } catch (err) {
        socket.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
      }
    });
  });

  console.log(`[ws] order intake listening on ${WS_PATH}`);
  return wss;
}

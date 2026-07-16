import { WebSocketServer } from 'ws';
import { createOrder } from '../services/orderService.js';
import { notifyNewOrder } from '../services/queueService.js';

const WS_PATH = '/ws/orders';

export function attachOrderSocket(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: WS_PATH });

  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'connected', message: 'Send an OrderRequest JSON payload to place an order.' }));

    socket.on('message', (raw) => {
      let orderRequest;
      try {
        orderRequest = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'invalid JSON payload' }));
        return;
      }

      try {
        const order = createOrder(orderRequest);
        notifyNewOrder();
        socket.send(JSON.stringify({ type: 'order_created', order }));
      } catch (err) {
        socket.send(JSON.stringify({ type: 'error', message: err.message }));
      }
    });
  });

  console.log(`[ws] order intake listening on ${WS_PATH}`);
  return wss;
}

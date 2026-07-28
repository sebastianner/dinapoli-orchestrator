import type { WebSocket } from 'ws';

// Every socket connected to /ws/orders (see orderSocket.ts) is tracked here so
// status changes and table flips can be pushed to all of them, not just
// whichever client happened to make the request that caused the change.
const clients = new Set<WebSocket>();

export function registerClient(socket: WebSocket): void {
  clients.add(socket);
  socket.on('close', () => clients.delete(socket));
}

function broadcast(payload: unknown): void {
  const message = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === client.OPEN) client.send(message);
  }
}

/** Pushed whenever an order is created or its status/items change, so every connected screen can refetch it instead of waiting for a manual refresh. */
export function broadcastOrderUpdate(orderId: number): void {
  broadcast({ type: 'order_updated', orderId });
}

/** Pushed whenever a table flips free/busy, so the Tables page stays live without a manual refresh. */
export function broadcastTablesUpdate(): void {
  broadcast({ type: 'tables_updated' });
}

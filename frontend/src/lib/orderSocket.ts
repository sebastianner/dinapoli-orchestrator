import type { Order, OrderRequest, OrderSocketServerMessage } from '@/types/api';

type PendingSubmission = {
  resolve: (order: Order) => void;
  reject: (err: Error) => void;
};

/**
 * Single shared connection to /ws/orders, used only for the order's first
 * submission (creation). Once an order exists, further changes go through
 * the REST endpoints instead. The backend replies to whatever message it
 * last received with no correlation id, so submissions are queued and
 * resolved one at a time in order.
 */
class OrderSocketClient {
  private socket: WebSocket | null = null;
  private connecting: Promise<WebSocket> | null = null;
  private queue: PendingSubmission[] = [];

  private connect(): Promise<WebSocket> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve(this.socket);
    }
    if (this.connecting) return this.connecting;

    this.connecting = new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws/orders`);

      socket.addEventListener('open', () => {
        this.socket = socket;
        this.connecting = null;
        resolve(socket);
      });

      socket.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data) as OrderSocketServerMessage;
        if (msg.type === 'connected') return;
        const pending = this.queue.shift();
        if (!pending) return;
        if (msg.type === 'order_created') pending.resolve(msg.order);
        else pending.reject(new Error(msg.message));
      });

      socket.addEventListener('close', () => {
        this.socket = null;
        this.connecting = null;
        for (const pending of this.queue.splice(0)) {
          pending.reject(new Error('conexión perdida antes de recibir respuesta'));
        }
      });

      socket.addEventListener('error', () => {
        this.connecting = null;
        reject(new Error('no se pudo conectar al servidor de órdenes'));
      });
    });

    return this.connecting;
  }

  async submitOrder(orderRequest: OrderRequest): Promise<Order> {
    const socket = await this.connect();
    return new Promise<Order>((resolve, reject) => {
      this.queue.push({ resolve, reject });
      socket.send(JSON.stringify(orderRequest));
    });
  }
}

export const orderSocketClient = new OrderSocketClient();

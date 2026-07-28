import type { Order, OrderRequest, OrderSocketServerMessage } from '@/types/api';

type PendingSubmission = {
  resolve: (order: Order) => void;
  reject: (err: Error) => void;
};

type BroadcastListener = (msg: OrderSocketServerMessage) => void;

const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 10000;

/**
 * Single shared connection to /ws/orders, used for two things:
 *  - Submitting a brand new order (queued request/reply - the backend replies
 *    to whatever message it last received with no correlation id, so
 *    submissions are resolved one at a time in order).
 *  - Listening for broadcasts the server pushes to every connected client
 *    without being asked - 'order_updated' and 'tables_updated' (see
 *    server/src/ws/broadcast.ts) - so any screen stays live without a manual
 *    refresh. connectPersistent() opens the connection eagerly and
 *    reconnects with capped backoff so this keeps working across a dropped
 *    connection, not just for the lifetime of a single order submission.
 */
class OrderSocketClient {
  private socket: WebSocket | null = null;
  private connecting: Promise<WebSocket> | null = null;
  private queue: PendingSubmission[] = [];
  private listeners = new Set<BroadcastListener>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stayConnected = false;

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
        this.reconnectAttempts = 0;
        resolve(socket);
      });

      socket.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data) as OrderSocketServerMessage;
        for (const listener of this.listeners) listener(msg);

        if (msg.type !== 'order_created' && msg.type !== 'error') return;
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
        if (this.stayConnected) this.scheduleReconnect();
      });

      socket.addEventListener('error', () => {
        this.connecting = null;
        reject(new Error('no se pudo conectar al servidor de órdenes'));
      });
    });

    return this.connecting;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {
        /* swallowed - scheduleReconnect runs again from the resulting close/error */
      });
    }, delay);
  }

  /** Opens the connection now and keeps it alive (auto-reconnecting) for the rest of the session, so broadcasts arrive without waiting for the first order submission. Call once, e.g. from the root layout. */
  connectPersistent(): void {
    this.stayConnected = true;
    this.connect().catch(() => {});
  }

  /** Subscribes to every message the server sends, including broadcasts that aren't a reply to a submission. Returns an unsubscribe function. */
  listen(listener: BroadcastListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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

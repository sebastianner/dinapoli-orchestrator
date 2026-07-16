import WebSocket from 'ws';

const url = process.env.WS_URL ?? 'ws://localhost:3000/ws/orders';
const ws = new WebSocket(url);

const order = {
  orderType: 'dine_in',
  tableNumber: 5,
  paymentMethod: 'cash',
  items: [
    { type: 'pizza', size: 'medium', flavors: ['margherita', 'hawaiian'], quantity: 1 },
    { type: 'product', category: 'drinks', product: 'soft_drink', option: 'Coca-Cola', quantity: 2 },
  ],
};

ws.on('open', () => {
  console.log('connected, sending order...');
  ws.send(JSON.stringify(order));
});

ws.on('message', (data) => {
  console.log('received:', data.toString());
  ws.close();
});

ws.on('error', (err) => {
  console.error('ws error:', err.message);
  process.exit(1);
});

import express from 'express';
import menuRouter from './routes/menu.js';
import ordersRouter from './routes/orders.js';
import tablesRouter from './routes/tables.js';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/menu', menuRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/tables', tablesRouter);

  app.use((req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const statusCode = err.statusCode ?? 500;
    if (statusCode === 500) console.error(err);
    res.status(statusCode).json({ error: err.message ?? 'internal server error' });
  });

  return app;
}

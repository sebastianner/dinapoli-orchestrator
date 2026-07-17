import express, { type ErrorRequestHandler } from 'express';
import menuRouter from './routes/menu.js';
import ordersRouter from './routes/orders.js';
import tablesRouter from './routes/tables.js';
import cashFlowRouter from './routes/cashFlow.js';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/menu', menuRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/tables', tablesRouter);
  app.use('/api/cash-flow', cashFlowRouter);

  app.use((req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    const statusCode = err?.statusCode ?? 500;
    if (statusCode === 500) console.error(err);
    res.status(statusCode).json({ error: err?.message ?? 'internal server error' });
  };
  app.use(errorHandler);

  return app;
}

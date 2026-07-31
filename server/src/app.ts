import express, { type ErrorRequestHandler } from 'express';
import cookieParser from 'cookie-parser';
import os from 'node:os';
import menuRouter from './routes/menu.js';
import ordersRouter from './routes/orders.js';
import tablesRouter from './routes/tables.js';
import cashFlowRouter from './routes/cashFlow.js';
import endOfDayRouter from './routes/endOfDay.js';
import employeesRouter from './routes/employees.js';
import authRouter from './routes/auth.js';
import customersRouter from './routes/customers.js';
import locationsRouter from './routes/locations.js';
import promosRouter from './routes/promos.js';
import productsRouter from './routes/products.js';
import pizzaAdminRouter from './routes/pizzaAdmin.js';
import analyticsRouter from './routes/analytics.js';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  // The browser can't see the machine's own LAN IP (main.tsx's startup log
  // needs it to tell staff what to type on a phone) - os.networkInterfaces()
  // only works server-side, hence this tiny endpoint instead of computing it
  // client-side.
  app.get('/api/lan-ip', (req, res) => {
    const interfaces = Object.values(os.networkInterfaces()).flat();
    const lanIp = interfaces.find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? null;
    res.json({ lanIp });
  });
  app.use('/api/auth', authRouter);
  app.use('/api/menu', menuRouter);
  app.use('/api/orders', ordersRouter);
  app.use('/api/tables', tablesRouter);
  app.use('/api/cash-flow', cashFlowRouter);
  app.use('/api/end-of-day', endOfDayRouter);
  app.use('/api/employees', employeesRouter);
  app.use('/api/customers', customersRouter);
  app.use('/api/locations', locationsRouter);
  app.use('/api/promos', promosRouter);
  app.use('/api/products', productsRouter);
  app.use('/api/pizza-admin', pizzaAdminRouter);
  app.use('/api/analytics', analyticsRouter);

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

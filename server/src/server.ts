import http from "node:http";
import { createApp } from "./app.js";
import { attachOrderSocket } from "./ws/orderSocket.js";
import { startQueueWorker } from "./services/queueService.js";
import { startPrinterMaintenance } from "./services/printerService.js";
import { startBackupWorker } from "./services/backupService.js";
import { getCurrentCashFlow } from "./services/cashFlowService.js";

const PORT = process.env.PORT ?? 3000;

const app = createApp();
const server = http.createServer(app);

const wss = attachOrderSocket(server);
// `ws` mirrors the underlying http.Server's 'error' event onto the
// WebSocketServer too - an EventEmitter throws synchronously on an 'error'
// emission with no listener, so without this, the EADDRINUSE retry below
// (which does have a listener, on `server`) never gets the chance to run:
// this unhandled mirrored copy crashes the process first.
wss.on("error", () => {});
startQueueWorker();
// Keeps the print queues un-paused on a timer, off the printing hot path -
// see printerService.ensurePrinterEnabled for why it can't be reactive.
startPrinterMaintenance();
startBackupWorker();
getCurrentCashFlow(); // opens today's register period if the latest one is from a previous day

server.on("listening", () => {
  console.log(`Dinapoli orchestrator listening on http://0.0.0.0:${PORT} (reachable via localhost or this machine's LAN IP)`);
});

const MAX_LISTEN_RETRIES = 40;
const LISTEN_RETRY_DELAY_MS = 300;
let listenAttempts = 0;
server.on("error", (err: NodeJS.ErrnoException) => {
  // `tsx watch`'s restart (kill the old process, spawn a new one) relies on
  // the old process's port being released by the time the new one binds -
  // on Windows that teardown isn't instant (and isn't guaranteed to be a
  // cooperative signal the old process can even react to), so the new
  // process can come up before the old one is actually gone. Retrying for a
  // while instead of crashing means a dev-mode restart recovers on its own
  // rather than needing to be run again by hand every time.
  if (err.code === "EADDRINUSE" && listenAttempts < MAX_LISTEN_RETRIES) {
    if (listenAttempts === 0) console.warn(`[startup] port ${PORT} still in use, waiting for it to free up...`);
    listenAttempts++;
    setTimeout(() => server.listen(Number(PORT), "0.0.0.0"), LISTEN_RETRY_DELAY_MS);
    return;
  }
  throw err;
});

// Bind to every interface, not just loopback, so other devices on the same
// LAN (other POS terminals, a phone/tablet checking the dashboard) can reach
// this by the host machine's local IP, not only from localhost.
server.listen(Number(PORT), "0.0.0.0");

// Best-effort - lets an interactive Ctrl+C (or any environment that does
// deliver a real signal) free the port immediately instead of leaving it to
// the retry loop above. Fire-and-forget on purpose: this is a local dev
// process with no in-flight traffic worth draining, so there's nothing to
// gain from waiting on close()'s callback before exiting.
function shutdown() {
  wss.close();
  server.close();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

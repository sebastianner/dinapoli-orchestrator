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

attachOrderSocket(server);
startQueueWorker();
// Keeps the print queues un-paused on a timer, off the printing hot path -
// see printerService.ensurePrinterEnabled for why it can't be reactive.
startPrinterMaintenance();
startBackupWorker();
getCurrentCashFlow(); // opens today's register period if the latest one is from a previous day

// Bind to every interface, not just loopback, so other devices on the same
// LAN (other POS terminals, a phone/tablet checking the dashboard) can reach
// this by the host machine's local IP, not only from localhost.
server.listen(Number(PORT), "0.0.0.0", () => {
  console.log(`Dinapoli orchestrator listening on http://0.0.0.0:${PORT} (reachable via localhost or this machine's LAN IP)`);
});

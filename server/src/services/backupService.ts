import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { google } from "googleapis";
import db from "../db/index.js";

const BACKUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
// Hourly backups, so 48 covers the last 2 days - old ones beyond that are
// pruned from Drive after each successful upload so storage stays bounded.
const RETENTION_COUNT = 48;
const DRIVE_FOLDER_NAME = "Dinapoli Backups";
const DRIVE_MIME_SQLITE = "application/x-sqlite3";
const DRIVE_MIME_FOLDER = "application/vnd.google-apps.folder";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

type DriveClient = ReturnType<typeof google.drive>;

let intervalHandle: ReturnType<typeof setInterval> | null = null;
// Looked up once and reused - avoids a find-or-create round trip on every
// single hourly run.
let cachedFolderId: string | null = null;

function getDriveClient(): DriveClient {
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error(
      "Google Drive backups are not configured - set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN in server/.env",
    );
  }
  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });
  return google.drive({ version: "v3", auth: oauth2Client });
}

async function getOrCreateBackupFolder(drive: DriveClient): Promise<string> {
  if (cachedFolderId) return cachedFolderId;

  const existing = await drive.files.list({
    q: `name = '${DRIVE_FOLDER_NAME}' and mimeType = '${DRIVE_MIME_FOLDER}' and trashed = false`,
    fields: "files(id, name)",
    spaces: "drive",
  });
  const found = existing.data.files?.[0]?.id;
  if (found) {
    cachedFolderId = found;
    return found;
  }

  const created = await drive.files.create({
    requestBody: { name: DRIVE_FOLDER_NAME, mimeType: DRIVE_MIME_FOLDER },
    fields: "id",
  });
  if (!created.data.id) throw new Error("Google Drive did not return an id for the created backup folder");
  cachedFolderId = created.data.id;
  return cachedFolderId;
}

/** yyyy-mm-ddThh-mm-ss - colon-free so it's a safe Drive/filesystem name. */
function backupTimestamp(): string {
  return new Date().toISOString().replace(/:/g, "-").split(".")[0];
}

/**
 * better-sqlite3's online backup API, not a raw file copy - the live DB is
 * in WAL mode and under active writes from the queue worker, so copying
 * dinapoli.sqlite directly could snapshot a torn/inconsistent state. This
 * produces a consistent snapshot into a scratch file, which is what
 * actually gets uploaded.
 */
async function snapshotDatabase(): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `dinapoli-backup-${Date.now()}.sqlite`);
  await db.backup(tmpPath);
  return tmpPath;
}

async function pruneOldBackups(drive: DriveClient, folderId: string): Promise<void> {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id, name, createdTime)",
    orderBy: "createdTime desc",
    pageSize: 1000,
    spaces: "drive",
  });
  const files = res.data.files ?? [];
  const toDelete = files.slice(RETENTION_COUNT);
  for (const file of toDelete) {
    if (!file.id) continue;
    try {
      await drive.files.delete({ fileId: file.id });
    } catch (err) {
      console.error(`[backup] failed to prune old backup ${file.name}:`, (err as Error).message);
    }
  }
}

export async function runBackup(): Promise<void> {
  let tmpPath: string | null = null;
  try {
    const drive = getDriveClient();
    const folderId = await getOrCreateBackupFolder(drive);

    tmpPath = await snapshotDatabase();
    const fileName = `dinapoli-${backupTimestamp()}.sqlite`;

    await drive.files.create({
      requestBody: { name: fileName, parents: [folderId] },
      media: { mimeType: DRIVE_MIME_SQLITE, body: fs.createReadStream(tmpPath) },
      fields: "id",
    });

    await pruneOldBackups(drive, folderId);
    console.log(`[backup] uploaded ${fileName} to Google Drive`);
  } catch (err) {
    console.error("[backup] failed:", (err as Error).message);
  } finally {
    if (tmpPath) {
      try {
        fs.rmSync(tmpPath, { force: true });
      } catch {
        // best effort cleanup of the scratch snapshot
      }
    }
  }
}

export function startBackupWorker(): void {
  runBackup(); // immediate pass at boot, same recovery-style convention as queueService
  intervalHandle = setInterval(runBackup, BACKUP_INTERVAL_MS);
  console.log(`[backup] worker started (every ${BACKUP_INTERVAL_MS}ms, retaining last ${RETENTION_COUNT})`);
}

export function stopBackupWorker(): void {
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = null;
}

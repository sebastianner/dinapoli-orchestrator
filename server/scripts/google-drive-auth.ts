// One-time setup for the Google Drive backup module (see
// src/services/backupService.ts). Run twice:
//
//   1. npm run gdrive:auth
//      Prints an authorization URL. Open it, log into the Google account
//      backups should land in, approve, and Google redirects to a
//      (probably unreachable) localhost URL - copy the "code" query param
//      from that address bar.
//
//   2. npm run gdrive:auth -- "<code>"
//      Exchanges the code for a refresh token and prints it. Paste it into
//      server/.env as GOOGLE_REFRESH_TOKEN.
//
// Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (from a Google Cloud
// OAuth 2.0 Client ID, type "Desktop app") already in server/.env - this
// script loads that file itself since it isn't run through `node
// --env-file`.
import { google } from "googleapis";

try {
  process.loadEnvFile();
} catch {
  // no server/.env yet - fall through, the missing-credentials check below
  // will report it clearly either way
}

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// Any redirect URI registered on the OAuth client works here - nothing
// actually needs to be listening on it, we only ever read the `code` query
// param off the address bar after Google redirects there.
const REDIRECT_URI = "http://localhost";

function requireCredentials(): void {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error(
      "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in server/.env first (from a Google Cloud OAuth 2.0 Client ID, type \"Desktop app\").",
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  requireCredentials();
  const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

  const [code] = process.argv.slice(2);

  if (!code) {
    const url = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent", // forces a refresh_token even on a re-run for the same account
      scope: ["https://www.googleapis.com/auth/drive.file"],
    });
    console.log("Open this URL, log in, and approve access:\n");
    console.log(url);
    console.log('\nThen re-run: npm run gdrive:auth -- "<code from the redirect URL>"');
    return;
  }

  const { tokens } = await oauth2Client.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      "Google didn't return a refresh_token. This account may already have an active grant for this app - " +
        "revoke access at https://myaccount.google.com/permissions and run `npm run gdrive:auth` again from step 1.",
    );
    process.exit(1);
  }

  console.log("Add this to server/.env:\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

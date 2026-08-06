using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Text;

// Auto-update-and-launch for the Dinapoli orchestrator.
//
// Run at Windows logon. On each run:
//   1. Fetches origin/main and compares it to the current HEAD.
//   2. If they differ and the working tree is clean, fast-forward pulls.
//   3. Always runs `npm run db:migrate` in server/ before any build, on
//      every single run - not just when a pull touched server/. The
//      database can drift out of sync with the code for reasons a git diff
//      can't see (a restored/reset db file, a manual schema tweak, etc.),
//      and a missing column crashes the server at startup. migrate.ts's
//      ensureColumn/etc. helpers are additive and safe to run repeatedly,
//      so this is cheap insurance and a no-op on a day with no schema
//      changes.
//   4. Rebuilds server/frontend if the pull touched that side, or its
//      dist/ was missing.
//   5. If HEAD and origin/main are the same (or the tree is dirty, or the
//      pull fails), it just launches whatever is already built - migrate
//      still runs regardless.
//   6. Starts the server (npm start) and frontend (npm run preview) fully
//      hidden (no console windows) with stdout/stderr redirected straight to
//      a log file per service - one file per calendar day, so a restart on
//      the same day appends rather than overwriting, and old days are easy
//      to find/prune.
//   7. Waits for both to accept connections, then opens the frontend in the
//      default browser.
//
// Everything the launcher itself does is also appended to startup-log.txt
// next to this exe, since there's no one watching a console at boot time.
class Program
{
    static string repoRoot;
    static string logPath;

    const int ServerPort = 3000;
    const int FrontendPort = 4173;

    static void Main()
    {
        repoRoot = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
        logPath = Path.Combine(repoRoot, "startup-log.txt");

        Log("==================================================");
        Log("Startup run: " + DateTime.Now);

        try
        {
            UpdateAndBuild();
        }
        catch (Exception ex)
        {
            Log("ERROR during update/build: " + ex);
        }

        try
        {
            string logsDir = Path.Combine(repoRoot, "logs");
            Directory.CreateDirectory(logsDir);
            string today = DateTime.Now.ToString("yyyy-MM-dd");
            string serverLog = Path.Combine(logsDir, "server-" + today + ".log");
            string frontendLog = Path.Combine(logsDir, "frontend-" + today + ".log");

            StartDetached(Path.Combine(repoRoot, "server"), "npm start", serverLog);
            StartDetached(Path.Combine(repoRoot, "frontend"), "npm run preview", frontendLog);

            bool serverUp = WaitForPort(ServerPort, 60);
            bool frontendUp = WaitForPort(FrontendPort, 60);

            if (serverUp && frontendUp)
            {
                Log("Both server and frontend are up. Opening browser.");
                Process.Start(new ProcessStartInfo
                {
                    FileName = "http://localhost:" + FrontendPort,
                    UseShellExecute = true
                });
            }
            else
            {
                Log("Timed out waiting for ports (server up=" + serverUp + ", frontend up=" + frontendUp + "). Not opening browser.");
            }
        }
        catch (Exception ex)
        {
            Log("ERROR starting programs: " + ex);
        }

        Log("Launcher finished.");
    }

    static void UpdateAndBuild()
    {
        bool serverBuilt = Directory.Exists(Path.Combine(repoRoot, "server", "dist"));
        bool frontendBuilt = Directory.Exists(Path.Combine(repoRoot, "frontend", "dist"));

        RunCommand(repoRoot, "git fetch origin main");

        string localSha = RunCommandCapture(repoRoot, "git rev-parse HEAD").Trim();
        string remoteSha = RunCommandCapture(repoRoot, "git rev-parse origin/main").Trim();

        bool upToDate = localSha.Length > 0 && localSha == remoteSha;

        bool serverChanged = false;
        bool frontendChanged = false;

        if (upToDate)
        {
            Log("No changes detected (HEAD == origin/main).");
        }
        else
        {
            Log("Changes detected: local=" + localSha + " remote=" + remoteSha);

            // Which side(s) the incoming commits actually touch, so a
            // frontend-only change doesn't cost a needless server rebuild
            // (and vice versa).
            string diffOutput = RunCommandCapture(repoRoot, "git diff --name-only " + localSha + " " + remoteSha);
            foreach (string line in diffOutput.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
            {
                if (line.StartsWith("server/", StringComparison.OrdinalIgnoreCase)) serverChanged = true;
                else if (line.StartsWith("frontend/", StringComparison.OrdinalIgnoreCase)) frontendChanged = true;
            }

            string status = RunCommandCapture(repoRoot, "git status --porcelain");
            if (!string.IsNullOrEmpty(status.Trim()))
            {
                Log("Working tree has uncommitted changes; skipping auto-pull to avoid overwriting local work:");
                Log(status);
                serverChanged = false;
                frontendChanged = false;
            }
            else
            {
                int pullExit = RunCommand(repoRoot, "git pull --ff-only origin main");
                if (pullExit != 0)
                {
                    Log("git pull failed (exit " + pullExit + "). Will run with whatever is already built.");
                    serverChanged = false;
                    frontendChanged = false;
                }
                else
                {
                    Log("Pull succeeded (server changed=" + serverChanged + ", frontend changed=" + frontendChanged + ").");
                }
            }
        }

        // Always migrate before building, and on every run - not just when
        // a pull touched server/ - since the database can drift out of sync
        // with the code for reasons a git diff can't see. See the header
        // comment for why this is safe to run unconditionally.
        RunMigrate();

        bool buildServer = serverChanged || !serverBuilt;
        bool buildFrontend = frontendChanged || !frontendBuilt;

        if (buildServer) BuildProject(Path.Combine(repoRoot, "server"), "server");
        else Log("server: no pulled changes and a build already exists - skipping rebuild.");

        if (buildFrontend) BuildProject(Path.Combine(repoRoot, "frontend"), "frontend");
        else Log("frontend: no pulled changes and a build already exists - skipping rebuild.");
    }

    static void RunMigrate()
    {
        string serverDir = Path.Combine(repoRoot, "server");

        // db:migrate runs via tsx off src/, so it needs node_modules present
        // even if the server hasn't been built yet (e.g. a fresh clone).
        Log("Installing server dependencies (needed for db:migrate)...");
        int installExit = RunCommand(serverDir, "npm install");
        if (installExit != 0)
        {
            Log("npm install failed for server (exit " + installExit + "). Attempting migration anyway.");
        }

        Log("Running database migration (npm run db:migrate)...");
        int migrateExit = RunCommand(serverDir, "npm run db:migrate");
        if (migrateExit != 0)
        {
            Log("Database migration failed (exit " + migrateExit + "). The server may fail to start or run against an outdated schema.");
        }
        else
        {
            Log("Database migration succeeded.");
        }
    }

    static void BuildProject(string dir, string label)
    {
        Log("Installing dependencies for " + label + "...");
        int installExit = RunCommand(dir, "npm install");
        if (installExit != 0)
        {
            Log("npm install failed for " + label + " (exit " + installExit + "). Attempting build anyway.");
        }

        Log("Building " + label + "...");
        int buildExit = RunCommand(dir, "npm run build");
        if (buildExit != 0)
        {
            Log("npm run build failed for " + label + " (exit " + buildExit + "). Will still try to launch with whatever exists.");
        }
        else
        {
            Log(label + " build succeeded.");
        }
    }

    static void StartDetached(string workDir, string command, string logFilePath)
    {
        Log("Starting " + command + " in " + workDir + " (logging to " + logFilePath + ")...");

        string separator = Environment.NewLine + "===== " + command + " started " + DateTime.Now + " =====" + Environment.NewLine;
        try { File.AppendAllText(logFilePath, separator, Encoding.UTF8); }
        catch { /* best effort */ }

        // Redirection happens at the shell/OS level (>>), not via .NET stream
        // events, so this process tree keeps writing to the file completely
        // independently of whether this launcher is still running.
        var psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = "/c " + command + " >> \"" + logFilePath + "\" 2>&1",
            WorkingDirectory = workDir,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        Process.Start(psi);
    }

    static bool WaitForPort(int port, int timeoutSeconds)
    {
        DateTime deadline = DateTime.Now.AddSeconds(timeoutSeconds);
        while (DateTime.Now < deadline)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var result = client.BeginConnect("127.0.0.1", port, null, null);
                    bool connected = result.AsyncWaitHandle.WaitOne(1000);
                    if (connected && client.Connected)
                    {
                        client.EndConnect(result);
                        return true;
                    }
                }
            }
            catch
            {
                // not up yet, keep polling
            }
            System.Threading.Thread.Sleep(1000);
        }
        return false;
    }

    static int RunCommand(string workDir, string command)
    {
        using (var p = new Process())
        {
            p.StartInfo.FileName = "cmd.exe";
            p.StartInfo.Arguments = "/c " + command;
            p.StartInfo.WorkingDirectory = workDir;
            p.StartInfo.UseShellExecute = false;
            p.StartInfo.RedirectStandardOutput = true;
            p.StartInfo.RedirectStandardError = true;
            p.StartInfo.CreateNoWindow = true;
            p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Log("  " + e.Data); };
            p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) Log("  [err] " + e.Data); };
            p.Start();
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            p.WaitForExit();
            return p.ExitCode;
        }
    }

    static string RunCommandCapture(string workDir, string command)
    {
        using (var p = new Process())
        {
            p.StartInfo.FileName = "cmd.exe";
            p.StartInfo.Arguments = "/c " + command;
            p.StartInfo.WorkingDirectory = workDir;
            p.StartInfo.UseShellExecute = false;
            p.StartInfo.RedirectStandardOutput = true;
            p.StartInfo.RedirectStandardError = true;
            p.StartInfo.CreateNoWindow = true;
            p.Start();
            string output = p.StandardOutput.ReadToEnd();
            p.StandardError.ReadToEnd();
            p.WaitForExit();
            return output;
        }
    }

    static void Log(string msg)
    {
        string line = "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + msg;
        try { File.AppendAllText(logPath, line + Environment.NewLine, Encoding.UTF8); }
        catch { /* best effort */ }
    }
}

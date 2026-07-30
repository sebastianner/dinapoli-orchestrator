<#
  Sends a file's raw bytes straight to a Windows print queue, bypassing GDI/
  driver rendering entirely (RAW datatype), via the WinSpool API - the
  Windows equivalent of `lp -o raw` on CUPS. Invoked by
  server/src/services/printerService.ts's writeToDevice() on win32 only;
  Linux/macOS keep using `lp` directly and never touch this file.

  Requires nothing beyond what ships with Windows itself (PowerShell 5.1+,
  winspool.drv) - no extra packages to install on the Windows machine.
#>
param(
    [Parameter(Mandatory = $true)][string]$PrinterName,
    [Parameter(Mandatory = $true)][string]$FilePath
)

$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class DinapoliRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public class DOCINFOA
    {
        [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern bool OpenPrinter(string szPrinter, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, DOCINFOA di);

    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, byte[] pBytes, int dwCount, out int dwWritten);

    public static void SendBytes(string printerName, byte[] bytes)
    {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new InvalidOperationException("OpenPrinter failed for '" + printerName + "' (error " + Marshal.GetLastWin32Error() + ")");

        try
        {
            var di = new DOCINFOA();
            di.pDocName = "Dinapoli ESC/POS Job";
            di.pDataType = "RAW";

            if (!StartDocPrinter(hPrinter, 1, di))
                throw new InvalidOperationException("StartDocPrinter failed (error " + Marshal.GetLastWin32Error() + ")");
            try
            {
                if (!StartPagePrinter(hPrinter))
                    throw new InvalidOperationException("StartPagePrinter failed (error " + Marshal.GetLastWin32Error() + ")");
                try
                {
                    int written;
                    if (!WritePrinter(hPrinter, bytes, bytes.Length, out written) || written != bytes.Length)
                        throw new InvalidOperationException("WritePrinter wrote " + written + " of " + bytes.Length + " bytes (error " + Marshal.GetLastWin32Error() + ")");
                }
                finally { EndPagePrinter(hPrinter); }
            }
            finally { EndDocPrinter(hPrinter); }
        }
        finally { ClosePrinter(hPrinter); }
    }
}
"@

$bytes = [System.IO.File]::ReadAllBytes($FilePath)
[DinapoliRawPrinter]::SendBytes($PrinterName, $bytes)

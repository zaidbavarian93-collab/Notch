# Notch - notification mirror. Watches the Windows notification store (wpndatabase.db)
# through the built-in winsqlite3.dll and prints every NEW toast as one JSON line.
# stdin commands: "activate <AUMID>"  -> bring that app to the front
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8

Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class WSql {
  [DllImport("winsqlite3.dll")] static extern int sqlite3_open_v2(byte[] filename, out IntPtr db, int flags, IntPtr vfs);
  [DllImport("winsqlite3.dll")] static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int n, out IntPtr stmt, IntPtr tail);
  [DllImport("winsqlite3.dll")] static extern int sqlite3_step(IntPtr stmt);
  [DllImport("winsqlite3.dll")] static extern int sqlite3_finalize(IntPtr stmt);
  [DllImport("winsqlite3.dll")] static extern int sqlite3_busy_timeout(IntPtr db, int ms);
  [DllImport("winsqlite3.dll")] static extern long sqlite3_column_int64(IntPtr stmt, int i);
  [DllImport("winsqlite3.dll")] static extern IntPtr sqlite3_column_blob(IntPtr stmt, int i);
  [DllImport("winsqlite3.dll")] static extern int sqlite3_column_bytes(IntPtr stmt, int i);
  [DllImport("winsqlite3.dll")] static extern int sqlite3_column_type(IntPtr stmt, int i);
  static IntPtr db = IntPtr.Zero;
  static byte[] Z(string s) { return Encoding.UTF8.GetBytes(s + "\0"); }
  public static bool Open(string path) {
    if (db != IntPtr.Zero) return true;
    int rc = sqlite3_open_v2(Z(path), out db, 1 /*READONLY*/, IntPtr.Zero);
    if (rc != 0) { db = IntPtr.Zero; return false; }
    sqlite3_busy_timeout(db, 1500);
    return true;
  }
  static string Col(IntPtr st, int i) {
    if (sqlite3_column_type(st, i) == 5) return "";
    int n = sqlite3_column_bytes(st, i); IntPtr p = sqlite3_column_blob(st, i);
    if (n <= 0 || p == IntPtr.Zero) return "";
    byte[] b = new byte[n]; Marshal.Copy(p, b, 0, n);
    return Encoding.UTF8.GetString(b);
  }
  // returns rows: id \x1f arrival \x1f aumid \x1f payload \x1e ...
  public static string Query(string sql) {
    IntPtr st; var sb = new StringBuilder();
    if (sqlite3_prepare_v2(db, Z(sql), -1, out st, IntPtr.Zero) != 0) return null;
    while (sqlite3_step(st) == 100) {
      sb.Append(sqlite3_column_int64(st, 0)).Append('\x1f').Append(sqlite3_column_int64(st, 1)).Append('\x1f')
        .Append(Col(st, 2)).Append('\x1f').Append(Col(st, 3)).Append('\x1e');
    }
    sqlite3_finalize(st);
    return sb.ToString();
  }
  public static long Scalar(string sql) {
    IntPtr st; long v = -1;
    if (sqlite3_prepare_v2(db, Z(sql), -1, out st, IntPtr.Zero) != 0) return -1;
    if (sqlite3_step(st) == 100) v = sqlite3_column_int64(st, 0);
    sqlite3_finalize(st); return v;
  }
}
public static class Win {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
'@

function Emit($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress -Depth 4)); [Console]::Out.Flush() }

$dbPath = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Notifications\wpndatabase.db'
if (-not (Test-Path $dbPath) -or -not [WSql]::Open($dbPath)) { Emit @{ type = 'notif-status'; ok = $false; error = 'cannot open notification store' }; exit 1 }

# app display names
$names = @{}
try { Get-StartApps | ForEach-Object { if ($_.AppID) { $names[$_.AppID.ToLower()] = $_.Name } } } catch { }
function Pretty-Name([string]$aumid) {
  if (-not $aumid) { return 'تطبيق' }
  $k = $aumid.ToLower()
  if ($names.ContainsKey($k)) { return $names[$k] }
  if ($k -match 'chrome') { return 'Google Chrome' }
  if ($k -match 'msedge') { return 'Microsoft Edge' }
  if ($k -match 'firefox') { return 'Firefox' }
  if ($k -match 'brave') { return 'Brave' }
  if ($k -match 'whatsapp') { return 'WhatsApp' }
  if ($k -match 'telegram') { return 'Telegram' }
  if ($k -match 'outlook') { return 'Outlook' }
  if ($k -match 'teams') { return 'Microsoft Teams' }
  $s = ($aumid -split '[!\\]')[-1]; $s = ($s -replace '\.exe$', '' -replace '^.*\.', '')
  if ($s) { return $s } else { return $aumid }
}
function Img-Data([string]$src) {
  if (-not $src) { return $null }
  if ($src -match '^https?://') { return $src }
  $p = $src -replace '^file:///', '' -replace '/', '\'
  if ($src -match '^ms-appdata:') { return $null }
  try {
    $fi = Get-Item -LiteralPath $p -ErrorAction Stop
    if ($fi.Length -gt 400KB) { return $null }
    $ext = $fi.Extension.TrimStart('.').ToLower(); if ($ext -eq 'jpg') { $ext = 'jpeg' }
    return "data:image/$ext;base64," + [Convert]::ToBase64String([IO.File]::ReadAllBytes($p))
  } catch { return $null }
}
function Is-Url([string]$s) { return ($s -match '^[a-zA-Z][a-zA-Z0-9+.-]{1,30}:' -and $s -notmatch '^(file|javascript|vbscript|data):') }

$sel = "SELECT n.Id, n.ArrivalTime, h.PrimaryId, n.Payload FROM Notification n JOIN NotificationHandler h ON h.RecordId = n.HandlerId WHERE n.Type = 'toast' AND n.Id > {0} ORDER BY n.Id LIMIT 20"
$last = [WSql]::Scalar('SELECT IFNULL(MAX(Id),0) FROM Notification')
Emit @{ type = 'notif-status'; ok = $true; last = $last }

$stdin = [Console]::In
$readTask = $stdin.ReadLineAsync()

while ($true) {
  if ($readTask.IsCompleted) {
    $cmd = $readTask.Result
    if ($null -eq $cmd) { break }
    if ($cmd -match '^activate (.+)$') {
      $aumid = $Matches[1].Trim(); $k = $aumid.ToLower(); $done = $false
      $guess = if ($k -match 'chrome') { 'chrome' } elseif ($k -match 'msedge') { 'msedge' } elseif ($k -match 'firefox') { 'firefox' } elseif ($k -match 'brave') { 'brave' } else { ((($aumid -split '[!\\]')[-1]) -replace '\.exe$', '' -replace '^.*\.', '') }
      $p = Get-Process -Name $guess -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
      if ($p) { if ([Win]::IsIconic($p.MainWindowHandle)) { [Win]::ShowWindow($p.MainWindowHandle, 9) | Out-Null }; $done = [Win]::SetForegroundWindow($p.MainWindowHandle) }
      if (-not $done) { Start-Process explorer.exe "shell:AppsFolder\$aumid" }
    }
    $readTask = $stdin.ReadLineAsync()
  }

  $rows = [WSql]::Query(($sel -f $last))
  if ($rows) {
    foreach ($r in $rows.Split([char]0x1e)) {
      if (-not $r) { continue }
      $f = $r.Split([char]0x1f)
      $id = [long]$f[0]; $last = [math]::Max($last, $id)
      $aumid = $f[2]; $payload = $f[3].TrimStart([char]0xFEFF).Trim([char]0)
      if ($aumid -match 'com\.zaid\.notch') { continue }
      try {
        [xml]$x = $payload
        $t = $x.toast
        $texts = @($t.visual.binding.text | ForEach-Object { if ($_ -is [string]) { $_ } else { $_.'#text' } } | Where-Object { $_ })
        $imgs = @($t.visual.binding.image)
        $logo = ($imgs | Where-Object { $_.placement -eq 'appLogoOverride' } | Select-Object -First 1).src
        if (-not $logo -and $imgs.Count) { $logo = ($imgs | Where-Object { -not $_.placement } | Select-Object -First 1).src }
        $acts = @()
        foreach ($a in @($t.actions.action)) {
          if (-not $a -or -not $a.content) { continue }
          $acts += @{ label = [string]$a.content; url = $(if ($a.activationType -eq 'protocol' -and (Is-Url $a.arguments)) { [string]$a.arguments } else { $null }) }
        }
        $launch = [string]$t.launch
        Emit @{ type = 'notif'; id = $id; appId = $aumid; app = (Pretty-Name $aumid);
                title = $(if ($texts.Count) { [string]$texts[0] } else { '' });
                body = $(if ($texts.Count -gt 1) { ($texts[1..($texts.Count - 1)] -join "`n") } else { '' });
                image = (Img-Data $logo);
                url = $(if (Is-Url $launch) { $launch } else { $null });
                actions = @($acts | Select-Object -First 3) }
      } catch { }
    }
  }
  Start-Sleep -Milliseconds 1200
}

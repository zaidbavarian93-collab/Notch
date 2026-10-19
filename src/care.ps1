# Notch - PC Care engine. Usage: care.ps1 -Action <name> [-Arg <json>]
# Prints a single JSON object to stdout.
param([string]$Action = 'summary', [string]$Arg = '{}')
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$a = $null; try { $a = $Arg | ConvertFrom-Json } catch { }
function Out($o) { [Console]::Out.Write(($o | ConvertTo-Json -Compress -Depth 5)) }

function Get-DirSize([string]$p) {
  if (-not $p -or -not (Test-Path -LiteralPath $p)) { return 0 }
  $s = (Get-ChildItem -LiteralPath $p -Recurse -Force -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  if ($s) { [int64]$s } else { 0 }
}
function Clear-Dir([string]$p) {
  if (-not $p -or -not (Test-Path -LiteralPath $p)) { return 0 }
  $before = Get-DirSize $p
  Get-ChildItem -LiteralPath $p -Force -ErrorAction SilentlyContinue | ForEach-Object {
    Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
  }
  $after = Get-DirSize $p
  [int64]($before - $after)
}

$L = $env:LOCALAPPDATA
$browserCaches = @(
  "$L\Google\Chrome\User Data\Default\Cache", "$L\Google\Chrome\User Data\Default\Code Cache",
  "$L\Microsoft\Edge\User Data\Default\Cache", "$L\Microsoft\Edge\User Data\Default\Code Cache",
  "$L\BraveSoftware\Brave-Browser\User Data\Default\Cache"
)
$targets = [ordered]@{
  temp       = @{ name = 'الملفات المؤقتة للمستخدم'; paths = @($env:TEMP) }
  wintemp    = @{ name = 'ملفات ويندوز المؤقتة'; paths = @("$env:WINDIR\Temp") }
  thumbs     = @{ name = 'ذاكرة الصور المصغّرة'; paths = @("$L\Microsoft\Windows\Explorer") ; filter = 'thumbcache_*.db' }
  browser    = @{ name = 'ذاكرة المتصفحات المؤقتة'; paths = $browserCaches }
  crash      = @{ name = 'تقارير الأعطال'; paths = @("$L\CrashDumps", "$env:ProgramData\Microsoft\Windows\WER\ReportArchive") }
  update     = @{ name = 'ملفات تحديث ويندوز القديمة'; paths = @("$env:WINDIR\SoftwareDistribution\Download") }
  deliveryop = @{ name = 'ملفات تحسين التسليم'; paths = @("$env:WINDIR\ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache") }
}

function Target-Size($t) {
  $sum = [int64]0
  foreach ($p in $t.paths) {
    if ($t.filter) { $x = (Get-ChildItem -LiteralPath $p -Filter $t.filter -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum; if ($x) { $sum += $x } }
    else { $sum += Get-DirSize $p }
  }
  $sum
}
function Recycle-Size {
  try {
    $sh = New-Object -ComObject Shell.Application
    $items = $sh.Namespace(10).Items(); $s = [int64]0
    foreach ($i in $items) { $s += [int64]$i.Size }
    return $s
  } catch { return 0 }
}

Add-Type -Namespace Native -Name Psapi -MemberDefinition @'
[DllImport("psapi.dll")] public static extern bool EmptyWorkingSet(IntPtr hProcess);
'@ -ErrorAction SilentlyContinue

switch ($Action) {

  'scan' {
    $list = @()
    foreach ($k in $targets.Keys) { $t = $targets[$k]; $list += @{ id = $k; name = $t.name; size = (Target-Size $t) } }
    $list += @{ id = 'recycle'; name = 'سلة المحذوفات'; size = (Recycle-Size) }
    Out @{ ok = $true; items = $list }
  }

  'clean' {
    $freed = [int64]0
    foreach ($id in @($a.ids)) {
      if ($id -eq 'recycle') { $s = Recycle-Size; Clear-RecycleBin -Force -ErrorAction SilentlyContinue; $freed += $s; continue }
      $t = $targets[$id]; if (-not $t) { continue }
      foreach ($p in $t.paths) {
        if ($t.filter) {
          Get-ChildItem -LiteralPath $p -Filter $t.filter -Force -ErrorAction SilentlyContinue | ForEach-Object { $len = $_.Length; Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue; if (-not (Test-Path -LiteralPath $_.FullName)) { $freed += $len } }
        } else { $freed += Clear-Dir $p }
      }
    }
    Out @{ ok = $true; freed = $freed }
  }

  'boost' {
    $before = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
    $n = 0
    Get-Process | Where-Object { $_.Id -ne $PID -and $_.WorkingSet64 -gt 30MB } | ForEach-Object {
      try { if ([Native.Psapi]::EmptyWorkingSet($_.Handle)) { $n++ } } catch { }
    }
    $tmp = Clear-Dir $env:TEMP
    Start-Sleep -Milliseconds 600
    $after = (Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory
    Out @{ ok = $true; ramFreed = [int64](($after - $before) * 1KB); tempFreed = $tmp; processes = $n }
  }

  'processes' {
    $cpuCount = [Environment]::ProcessorCount
    $list = Get-Process | Where-Object { $_.Id -gt 4 } | Group-Object ProcessName | ForEach-Object {
      $g = $_.Group
      $desc = $null; try { $desc = $g[0].MainModule.FileVersionInfo.FileDescription } catch { }
      @{ name = $_.Name; title = $(if ($desc) { $desc } else { $_.Name }); count = $g.Count;
         mem = [int64](($g | Measure-Object WorkingSet64 -Sum).Sum); hasWindow = [bool]($g | Where-Object { $_.MainWindowHandle -ne 0 }) }
    } | Sort-Object { $_.mem } -Descending | Select-Object -First 25
    Out @{ ok = $true; items = @($list) }
  }

  'kill' {
    $n = 0
    Get-Process -Name $a.name -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Kill(); $n++ } catch { } }
    Out @{ ok = ($n -gt 0); killed = $n }
  }

  'startup' {
    $items = @()
    $approved = @{
      'HKCU_Run' = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
      'HKLM_Run' = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run'
      'Folder'   = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder'
    }
    function State($scope, $name) {
      $v = (Get-ItemProperty -Path $approved[$scope] -Name $name -ErrorAction SilentlyContinue).$name
      if ($v -and $v.Length -gt 0 -and ($v[0] % 2) -eq 1) { return $false } else { return $true }
    }
    foreach ($src in @(@{ s = 'HKCU_Run'; k = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'; w = $true }, @{ s = 'HKLM_Run'; k = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run'; w = $false })) {
      $p = Get-ItemProperty -Path $src.k -ErrorAction SilentlyContinue
      if ($p) { $p.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object {
        $items += @{ name = $_.Name; cmd = [string]$_.Value; scope = $src.s; enabled = (State $src.s $_.Name); canEdit = $src.w } } }
    }
    $sf = [Environment]::GetFolderPath('Startup')
    Get-ChildItem -LiteralPath $sf -File -ErrorAction SilentlyContinue | ForEach-Object {
      $items += @{ name = $_.Name; cmd = $_.FullName; scope = 'Folder'; enabled = (State 'Folder' $_.Name); canEdit = $true }
    }
    Out @{ ok = $true; items = $items }
  }

  'startup-set' {
    $path = if ($a.scope -eq 'Folder') { 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder' }
            elseif ($a.scope -eq 'HKLM_Run') { 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' }
            else { 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run' }
    if (-not (Test-Path $path)) { New-Item -Path $path -Force | Out-Null }
    $bytes = [byte[]](@($(if ($a.enabled) { 2 } else { 3 })) + @(0) * 11)
    try { Set-ItemProperty -Path $path -Name $a.name -Value $bytes -Type Binary -ErrorAction Stop; Out @{ ok = $true } }
    catch { Out @{ ok = $false; error = 'يتطلب صلاحيات المدير' } }
  }

  'large' {
    $min = if ($a.minMB) { [int64]$a.minMB * 1MB } else { 500MB }
    $roots = @("$env:USERPROFILE\Downloads", "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Documents", "$env:USERPROFILE\Videos", "$env:USERPROFILE\Pictures", "$env:USERPROFILE\Music", "$env:USERPROFILE\OneDrive")
    $files = foreach ($r in $roots) { if (Test-Path -LiteralPath $r) { Get-ChildItem -LiteralPath $r -Recurse -File -Force -ErrorAction SilentlyContinue | Where-Object { $_.Length -ge $min -and -not ($_.Attributes -band [IO.FileAttributes]::Offline) } } }
    $top = $files | Sort-Object Length -Descending | Select-Object -First 40 | ForEach-Object { @{ path = $_.FullName; name = $_.Name; size = $_.Length; modified = $_.LastWriteTime.ToString('yyyy-MM-dd') } }
    Out @{ ok = $true; items = @($top) }
  }

  'health' {
    $os = Get-CimInstance Win32_OperatingSystem
    $uptimeH = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)
    $mp = $null; try { $mp = Get-MpComputerStatus -ErrorAction Stop } catch { }
    $wu = $null
    try { $wu = (New-Object -ComObject Microsoft.Update.AutoUpdate).Results.LastInstallationSuccessDate } catch { }
    $startupCount = 0
    foreach ($k in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Run', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Run')) {
      $p = Get-ItemProperty -Path $k -ErrorAction SilentlyContinue; if ($p) { $startupCount += @($p.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' }).Count } }
    $startupCount += @(Get-ChildItem -LiteralPath ([Environment]::GetFolderPath('Startup')) -File -ErrorAction SilentlyContinue).Count
    Out @{ ok = $true; uptimeHours = $uptimeH; osName = $os.Caption; build = $os.BuildNumber;
      defender = $(if ($mp) { @{ rtp = $mp.RealTimeProtectionEnabled; sigAgeDays = $mp.AntivirusSignatureAge; lastQuickScanDays = $(if ($mp.QuickScanEndTime) { [math]::Round(((Get-Date) - $mp.QuickScanEndTime).TotalDays) } else { -1 }) } } else { $null });
      lastUpdateDays = $(if ($wu) { [math]::Round(((Get-Date) - [datetime]$wu).TotalDays) } else { -1 });
      startupCount = $startupCount; recycle = (Recycle-Size); temp = (Get-DirSize $env:TEMP) }
  }

  'defender-scan' {
    try { Start-MpScan -ScanType QuickScan -AsJob | Out-Null; Out @{ ok = $true } } catch { Out @{ ok = $false } }
  }

  default { Out @{ ok = $false; error = 'unknown action' } }
}

# Notch for Windows - media + app watcher
# Emits one JSON object per line on stdout; reads commands (toggle/next/prev) from stdin.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding  = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [Type]$t) {
  $task = $asTaskGeneric.MakeGenericMethod($t).Invoke($null, @($op))
  if ($task.Wait(3000)) { return $task.Result } else { return $null }
}

[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
$MgrT = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$PropsT = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$mgr = Await ($MgrT::RequestAsync()) $MgrT

function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 3)); [Console]::Out.Flush() }

function Get-Art($props) {
  try {
    if (-not $props.Thumbnail) { return $null }
    $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
    if (-not $stream) { return $null }
    $net = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
    $ms = New-Object System.IO.MemoryStream
    $net.CopyTo($ms)
    $b64 = [Convert]::ToBase64String($ms.ToArray())
    $ms.Dispose(); $net.Dispose()
    return 'data:image/png;base64,' + $b64
  } catch { return $null }
}

$stdin = [Console]::In
$readTask = $stdin.ReadLineAsync()
$lastKey = ''
$lastSent = ''
$knownApps = $null
$tick = 0
$selfNames = @('notch', 'electron', 'powershell', 'conhost', 'applicationframehost', 'textinputhost', 'shellexperiencehost', 'searchhost', 'startmenuexperiencehost', 'systemsettings', 'lockapp')

while ($true) {
  # ---- commands
  if ($readTask.IsCompleted) {
    $cmd = $readTask.Result
    if ($null -eq $cmd) { break }   # parent closed
    $s = if ($mgr) { $mgr.GetCurrentSession() } else { $null }
    if ($s) {
      switch ($cmd.Trim()) {
        'toggle' { [void](Await ($s.TryTogglePlayPauseAsync()) ([bool])) }
        'next'   { [void](Await ($s.TrySkipNextAsync()) ([bool])) }
        'prev'   { [void](Await ($s.TrySkipPreviousAsync()) ([bool])) }
      }
    }
    $readTask = $stdin.ReadLineAsync()
    $lastSent = ''
  }

  # ---- media session
  try {
    $s = if ($mgr) { $mgr.GetCurrentSession() } else { $null }
    if ($s) {
      $p = Await ($s.TryGetMediaPropertiesAsync()) $PropsT
      $info = $s.GetPlaybackInfo()
      $tl = $s.GetTimelineProperties()
      $playing = ($info.PlaybackStatus.ToString() -eq 'Playing')
      $pos = $tl.Position.TotalSeconds
      if ($playing -and $tl.LastUpdatedTime.Year -gt 2000) {
        $pos += ([DateTimeOffset]::Now - $tl.LastUpdatedTime).TotalSeconds
      }
      $dur = ($tl.EndTime - $tl.StartTime).TotalSeconds
      $app = $s.SourceAppUserModelId
      $source = if ($app -match 'chrome|msedge|firefox|opera|brave') { 'browser' } elseif ($app -match 'spotify') { 'spotify' } else { 'app' }
      $key = "$($p.Artist)|$($p.Title)"
      if ($key -ne $lastKey) {
        $lastKey = $key
        $art = Get-Art $p
        Emit @{ type = 'art'; key = $key; art = $art }
      }
      $msg = @{ type = 'media'; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle; playing = $playing; position = [math]::Round($pos, 2); duration = [math]::Round($dur, 1); app = $app; source = $source; key = $key }
      Emit $msg
    } else {
      if ($lastKey -ne '') { $lastKey = '' }
      Emit @{ type = 'media'; title = ''; playing = $false }
    }
  } catch { }

  # ---- newly opened apps (every ~2s)
  $tick++
  if ($tick % 3 -eq 0) {
    try {
      $now = @{}
      Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | ForEach-Object {
        $n = $_.ProcessName.ToLower()
        if ($selfNames -notcontains $n -and -not $now.ContainsKey($n)) {
          $desc = $null
          try { $desc = $_.MainModule.FileVersionInfo.FileDescription } catch { }
          if (-not $desc) { $desc = $_.ProcessName }
          $now[$n] = $desc
        }
      }
      if ($null -ne $knownApps) {
        foreach ($k in $now.Keys) { if (-not $knownApps.ContainsKey($k)) { Emit @{ type = 'app'; name = $now[$k] } } }
      }
      $knownApps = $now
    } catch { }
  }

  Start-Sleep -Milliseconds 650
}

# Notch - taskbar styler (like TranslucentTB). Reads JSON lines on stdin:
#   {"mode":"default|clear|blur|acrylic|color","color":"#RRGGBB","opacity":0.0-1.0}
# Applies SetWindowCompositionAttribute to every Shell_TrayWnd / Shell_SecondaryTrayWnd,
# re-applying continuously because Explorer resets the style on hover / Start menu.
$ErrorActionPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Threading;
using System.Runtime.InteropServices;
public static class TB {
  [StructLayout(LayoutKind.Sequential)] struct AccentPolicy { public int State; public int Flags; public uint Color; public int AnimId; }
  [StructLayout(LayoutKind.Sequential)] struct WCAData { public int Attr; public IntPtr Data; public int Size; }
  [DllImport("user32.dll")] static extern int SetWindowCompositionAttribute(IntPtr h, ref WCAData d);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p, IntPtr after, string cls, string title);
  public static volatile int State = 0;     // 0 off, 1 gradient, 2 transparent gradient, 3 blur, 4 acrylic
  public static volatile uint Color = 0;    // 0xAABBGGRR
  public static volatile bool Run = true;
  static bool restored = true;
  static void Apply(IntPtr h, int state, uint color) {
    var p = new AccentPolicy { State = state, Flags = (state == 0 ? 0 : 2), Color = color, AnimId = 0 };
    int sz = Marshal.SizeOf(p); IntPtr mem = Marshal.AllocHGlobal(sz);
    try { Marshal.StructureToPtr(p, mem, false); var d = new WCAData { Attr = 19, Data = mem, Size = sz }; SetWindowCompositionAttribute(h, ref d); }
    finally { Marshal.FreeHGlobal(mem); }
  }
  static void ForAll(int state, uint color) {
    IntPtr h = FindWindowEx(IntPtr.Zero, IntPtr.Zero, "Shell_TrayWnd", null);
    if (h != IntPtr.Zero) Apply(h, state, color);
    IntPtr s = IntPtr.Zero;
    while ((s = FindWindowEx(IntPtr.Zero, s, "Shell_SecondaryTrayWnd", null)) != IntPtr.Zero) Apply(s, state, color);
  }
  public static void Loop() {
    while (Run) {
      int st = State;
      if (st != 0) { ForAll(st, Color); restored = false; }
      else if (!restored) { ForAll(0, 0); restored = true; }
      Thread.Sleep(st != 0 ? 40 : 400);
    }
    ForAll(0, 0);
  }
  public static void Start() { var t = new Thread(Loop); t.IsBackground = true; t.Start(); }
}
'@

function To-ABGR([string]$hex, [double]$op) {
  $h = $hex.TrimStart('#'); if ($h.Length -ne 6) { $h = '000000' }
  $r = [Convert]::ToInt32($h.Substring(0, 2), 16); $g = [Convert]::ToInt32($h.Substring(2, 2), 16); $b = [Convert]::ToInt32($h.Substring(4, 2), 16)
  $a = [int][math]::Round([math]::Max(0, [math]::Min(1, $op)) * 255)
  return [uint32](($a -shl 24) -bor ($b -shl 16) -bor ($g -shl 8) -bor $r)
}

[TB]::Start()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $c = $line | ConvertFrom-Json
    $op = if ($null -ne $c.opacity) { [double]$c.opacity } else { 0.5 }
    $col = if ($c.color) { [string]$c.color } else { '#000000' }
    switch ($c.mode) {
      'clear'   { [TB]::Color = 0; [TB]::State = 2 }
      'blur'    { [TB]::Color = (To-ABGR $col ([math]::Min($op, 0.6))); [TB]::State = 3 }
      'acrylic' { [TB]::Color = (To-ABGR $col ([math]::Max(0.01, $op))); [TB]::State = 4 }
      'color'   { [TB]::Color = (To-ABGR $col $op); [TB]::State = 2 }
      default   { [TB]::State = 0 }
    }
  } catch { }
}
[TB]::Run = $false
Start-Sleep -Milliseconds 600

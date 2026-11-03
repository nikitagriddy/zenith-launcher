# Zenith NVIDIA driver-profile helper.
# Talks to NVIDIA's own driver API (nvapi64.dll, installed with the driver) to change per-game driver
# settings, the same store NVIDIA Control Panel uses. Never touches game files or game processes.
#
# Usage:
#   nvdrs.ps1 probe
#   nvdrs.ps1 get    <exe> <id> [<id> ...]
#   nvdrs.ps1 apply  <exe> <id>=<value> [...]          (prints prev.<id>=custom:<v> | prev.<id>=none)
#   nvdrs.ps1 revert <exe> <id>=custom:<v>|none [...]
#   nvdrs.ps1 dropprofile <exe>                         (removes a profile Zenith created for <exe>)
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Action,
  [Parameter(Position = 1)][string]$Exe = '',
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Items = @()
)

$ErrorActionPreference = 'Stop'
$source = @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public static class ZenithNv {
  [DllImport("nvapi64.dll", EntryPoint = "nvapi_QueryInterface", CallingConvention = CallingConvention.Cdecl)]
  static extern IntPtr QueryInterface(uint id);

  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnVoid();
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnOutHandle(out IntPtr h);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnSession(IntPtr s);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnFindApp(IntPtr s, IntPtr name, out IntPtr profile, IntPtr app);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnFindProfile(IntPtr s, IntPtr name, out IntPtr profile);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnCreateProfile(IntPtr s, IntPtr info, out IntPtr profile);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnProfilePtr(IntPtr s, IntPtr p, IntPtr data);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnGetSetting(IntPtr s, IntPtr p, uint id, IntPtr setting);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnDeleteSetting(IntPtr s, IntPtr p, uint id);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnProfile(IntPtr s, IntPtr p);

  static T Fn<T>(uint id) where T : class {
    IntPtr p = QueryInterface(id);
    if (p == IntPtr.Zero) throw new Exception("NVIDIA driver function 0x" + id.ToString("X8") + " is not available");
    return (T)(object)Marshal.GetDelegateForFunctionPointer(p, typeof(T));
  }

  // Struct sizes from NVIDIA's public nvapi.h. Version = size | (struct version << 16).
  const int SETTING_SIZE = 12320, PROFILE_SIZE = 4116, APP_SIZE = 16396;
  const uint SETTING_VER = SETTING_SIZE | (1u << 16), PROFILE_VER = PROFILE_SIZE | (1u << 16), APP_VER = APP_SIZE | (3u << 16);
  const int OFF_SETTING_ID = 4100, OFF_SETTING_TYPE = 4104, OFF_LOCATION = 4108, OFF_IS_PREDEF = 4112, OFF_CURRENT = 8220;
  public const string OWN_PREFIX = "Zenith - ";

  static IntPtr Alloc(int size) { IntPtr p = Marshal.AllocHGlobal(size); byte[] z = new byte[size]; Marshal.Copy(z, 0, p, size); return p; }
  static void WriteStr(IntPtr buf, int offset, string s) { byte[] b = Encoding.Unicode.GetBytes(s + "\0"); Marshal.Copy(b, 0, buf + offset, Math.Min(b.Length, 4096)); }

  static IntPtr session = IntPtr.Zero;

  static void Check(int status, string what) { if (status != 0) throw new Exception(what + " failed (NVAPI status " + status + ")"); }

  public static void Open() {
    Check(Fn<FnVoid>(0x0150E828)(), "NvAPI_Initialize");
    Check(Fn<FnOutHandle>(0x0694D52E)(out session), "Create driver session");
    Check(Fn<FnSession>(0x375DBD6B)(session), "Load driver settings");
  }
  public static void Save() { Check(Fn<FnSession>(0xFCBC7E14)(session), "Save driver settings"); }
  public static void Close() { if (session != IntPtr.Zero) { Fn<FnSession>(0xDAD9CFF8)(session); session = IntPtr.Zero; } }

  /** The driver profile that applies to this exe; with create=true, makes "Zenith - <exe>" if none exists. */
  public static IntPtr ProfileFor(string exe, bool create, out bool ours) {
    ours = false;
    IntPtr name = Alloc(4096), app = Alloc(APP_SIZE);
    try {
      WriteStr(name, 0, exe);
      Marshal.WriteInt32(app, 0, (int)APP_VER);
      IntPtr profile;
      if (Fn<FnFindApp>(0xEEE566B2)(session, name, out profile, app) == 0) {
        IntPtr pinfo = Alloc(PROFILE_SIZE);
        // An existing profile might still be one Zenith made earlier.
        try { ours = ProfileName(profile).StartsWith(OWN_PREFIX); } finally { Marshal.FreeHGlobal(pinfo); }
        return profile;
      }
      if (!create) return IntPtr.Zero;
      IntPtr info = Alloc(PROFILE_SIZE);
      try {
        Marshal.WriteInt32(info, 0, (int)PROFILE_VER);
        WriteStr(info, 4, OWN_PREFIX + exe);
        Check(Fn<FnCreateProfile>(0xCC176068)(session, info, out profile), "Create driver profile");
      } finally { Marshal.FreeHGlobal(info); }
      IntPtr newApp = Alloc(APP_SIZE);
      try {
        Marshal.WriteInt32(newApp, 0, (int)APP_VER);
        WriteStr(newApp, 8, exe);
        Check(Fn<FnProfilePtr>(0x4347A9DE)(session, profile, newApp), "Attach game to driver profile");
      } finally { Marshal.FreeHGlobal(newApp); }
      ours = true;
      return profile;
    } finally { Marshal.FreeHGlobal(name); Marshal.FreeHGlobal(app); }
  }

  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int FnGetProfileInfo(IntPtr s, IntPtr p, IntPtr info);
  static string ProfileName(IntPtr profile) {
    IntPtr info = Alloc(PROFILE_SIZE);
    try {
      Marshal.WriteInt32(info, 0, (int)PROFILE_VER);
      if (Fn<FnGetProfileInfo>(0x61CD6FD6)(session, profile, info) != 0) return "";
      return Marshal.PtrToStringUni(info + 4) ?? "";
    } finally { Marshal.FreeHGlobal(info); }
  }

  /** "custom:<value>" when this profile itself overrides the setting, otherwise "none". */
  public static string Get(IntPtr profile, uint id) {
    IntPtr s = Alloc(SETTING_SIZE);
    try {
      Marshal.WriteInt32(s, 0, (int)SETTING_VER);
      int st = Fn<FnGetSetting>(0x73BF8338)(session, profile, id, s);
      if (st != 0) return "none";
      int location = Marshal.ReadInt32(s, OFF_LOCATION);
      int predefined = Marshal.ReadInt32(s, OFF_IS_PREDEF);
      uint value = (uint)Marshal.ReadInt32(s, OFF_CURRENT);
      return (location == 0 && predefined == 0) ? "custom:" + value : "none";
    } finally { Marshal.FreeHGlobal(s); }
  }

  public static void Set(IntPtr profile, uint id, uint value) {
    IntPtr s = Alloc(SETTING_SIZE);
    try {
      Marshal.WriteInt32(s, 0, (int)SETTING_VER);
      Marshal.WriteInt32(s, OFF_SETTING_ID, (int)id);
      Marshal.WriteInt32(s, OFF_SETTING_TYPE, 0); // NVDRS_DWORD_TYPE
      Marshal.WriteInt32(s, OFF_CURRENT, (int)value);
      Check(Fn<FnProfilePtr>(0x577DD202)(session, profile, s), "Set driver setting 0x" + id.ToString("X8"));
    } finally { Marshal.FreeHGlobal(s); }
  }

  public static void Delete(IntPtr profile, uint id) { Fn<FnDeleteSetting>(0xE4A26362)(session, profile, id); }
  public static void DropProfile(IntPtr profile) { Check(Fn<FnProfile>(0x17093206)(session, profile), "Delete driver profile"); }
}
'@

function Parse-Id([string]$s) { if ($s -match '^0x') { [Convert]::ToUInt32($s.Substring(2), 16) } else { [uint32]$s } }

try {
  if (-not ('ZenithNv' -as [type])) { Add-Type -TypeDefinition $source -Language CSharp }
  [ZenithNv]::Open()
  try {
    switch ($Action) {
      'probe' { 'ok=1' }
      'get' {
        $ours = $false
        $p = [ZenithNv]::ProfileFor($Exe, $false, [ref]$ours)
        if ($p -eq [IntPtr]::Zero) { 'profile=none' } else {
          "profile=$(if ($ours) { 'zenith' } else { 'existing' })"
          foreach ($i in $Items) { $id = Parse-Id $i; "value.$i=$([ZenithNv]::Get($p, $id))" }
        }
      }
      'apply' {
        $ours = $false
        $p = [ZenithNv]::ProfileFor($Exe, $true, [ref]$ours)
        "profile=$(if ($ours) { 'zenith' } else { 'existing' })"
        foreach ($kv in $Items) {
          $k, $v = $kv.Split('=', 2); $id = Parse-Id $k
          "prev.$k=$([ZenithNv]::Get($p, $id))"
          [ZenithNv]::Set($p, $id, [uint32]$v)
        }
        [ZenithNv]::Save()
        'ok=1'
      }
      'revert' {
        $ours = $false
        $p = [ZenithNv]::ProfileFor($Exe, $false, [ref]$ours)
        if ($p -ne [IntPtr]::Zero) {
          foreach ($kv in $Items) {
            $k, $v = $kv.Split('=', 2); $id = Parse-Id $k
            if ($v -like 'custom:*') { [ZenithNv]::Set($p, $id, [uint32]$v.Substring(7)) } else { [ZenithNv]::Delete($p, $id) }
          }
          [ZenithNv]::Save()
        }
        'ok=1'
      }
      'dropprofile' {
        $ours = $false
        $p = [ZenithNv]::ProfileFor($Exe, $false, [ref]$ours)
        if ($p -ne [IntPtr]::Zero -and $ours) { [ZenithNv]::DropProfile($p); [ZenithNv]::Save(); 'dropped=1' } else { 'dropped=0' }
      }
      default { throw "Unknown action $Action" }
    }
  } finally { [ZenithNv]::Close() }
} catch {
  "error=$($_.Exception.Message)"
  exit 1
}

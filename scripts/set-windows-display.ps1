# Copyright (C) 2024-2026 Sjors Robroek
# SPDX-License-Identifier: AGPL-3.0-only
#
# Set the primary display of a hosted Windows runner to the given size and
# fail unless the system then reports that size. Hosted runners start at
# 1024x768. The window runtime checks need a monitor that holds the
# 1280x640 minimum client size.
param(
    [int]$Width = 1920,
    [int]$Height = 1080
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class PvDisplay {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
    public struct DEVMODE {
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
        public short dmSpecVersion;
        public short dmDriverVersion;
        public short dmSize;
        public short dmDriverExtra;
        public int dmFields;
        public int dmPositionX;
        public int dmPositionY;
        public int dmDisplayOrientation;
        public int dmDisplayFixedOutput;
        public short dmColor;
        public short dmDuplex;
        public short dmYResolution;
        public short dmTTOption;
        public short dmCollate;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
        public short dmLogPixels;
        public int dmBitsPerPel;
        public int dmPelsWidth;
        public int dmPelsHeight;
        public int dmDisplayFlags;
        public int dmDisplayFrequency;
        public int dmICMMethod;
        public int dmICMIntent;
        public int dmMediaType;
        public int dmDitherType;
        public int dmReserved1;
        public int dmReserved2;
        public int dmPanningWidth;
        public int dmPanningHeight;
    }

    [DllImport("user32.dll", CharSet = CharSet.Ansi)]
    public static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);

    [DllImport("user32.dll", CharSet = CharSet.Ansi)]
    public static extern int ChangeDisplaySettings(ref DEVMODE devMode, int flags);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int index);
}
'@

$ENUM_CURRENT_SETTINGS = -1
$DM_PELSWIDTH = 0x80000
$DM_PELSHEIGHT = 0x100000
$DISP_CHANGE_SUCCESSFUL = 0

$mode = New-Object PvDisplay+DEVMODE
$mode.dmSize = [System.Runtime.InteropServices.Marshal]::SizeOf($mode)
if (-not [PvDisplay]::EnumDisplaySettings($null, $ENUM_CURRENT_SETTINGS, [ref]$mode)) {
    throw 'EnumDisplaySettings could not read the current display mode.'
}
Write-Output "Display before: $($mode.dmPelsWidth)x$($mode.dmPelsHeight)"
$mode.dmPelsWidth = $Width
$mode.dmPelsHeight = $Height
$mode.dmFields = $DM_PELSWIDTH -bor $DM_PELSHEIGHT
$result = [PvDisplay]::ChangeDisplaySettings([ref]$mode, 0)
if ($result -ne $DISP_CHANGE_SUCCESSFUL) {
    throw "ChangeDisplaySettings returned $result for ${Width}x${Height}."
}

$actualWidth = [PvDisplay]::GetSystemMetrics(0)
$actualHeight = [PvDisplay]::GetSystemMetrics(1)
Write-Output "Display after: ${actualWidth}x${actualHeight}"
if ($actualWidth -ne $Width -or $actualHeight -ne $Height) {
    throw "The display is ${actualWidth}x${actualHeight}, not ${Width}x${Height}."
}

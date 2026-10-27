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

    [DllImport("user32.dll", CharSet = CharSet.Ansi, SetLastError = true)]
    static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);

    [DllImport("user32.dll", CharSet = CharSet.Ansi)]
    static extern int ChangeDisplaySettings(ref DEVMODE devMode, int flags);

    [DllImport("user32.dll")]
    public static extern int GetSystemMetrics(int index);

    const int ENUM_CURRENT_SETTINGS = -1;
    const int DM_PELSWIDTH = 0x80000;
    const int DM_PELSHEIGHT = 0x100000;

    static DEVMODE NewMode() {
        DEVMODE mode = new DEVMODE();
        mode.dmDeviceName = new string('\0', 32);
        mode.dmFormName = new string('\0', 32);
        mode.dmSize = (short)Marshal.SizeOf(typeof(DEVMODE));
        return mode;
    }

    // The struct stays in C#, so no PowerShell copy of it reaches the API.
    public static string Apply(int width, int height) {
        DEVMODE current = NewMode();
        if (!EnumDisplaySettings(null, ENUM_CURRENT_SETTINGS, ref current)) {
            throw new InvalidOperationException(
                "EnumDisplaySettings could not read the current mode (Win32 error " + Marshal.GetLastWin32Error() + ")");
        }
        string before = current.dmPelsWidth + "x" + current.dmPelsHeight;
        current.dmPelsWidth = width;
        current.dmPelsHeight = height;
        current.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT;
        int result = ChangeDisplaySettings(ref current, 0);
        if (result != 0) {
            throw new InvalidOperationException(
                "ChangeDisplaySettings returned " + result + " for " + width + "x" + height + " (was " + before + "); modes: " + Modes());
        }
        return before;
    }

    static string Modes() {
        var sizes = new System.Collections.Generic.SortedSet<string>();
        DEVMODE mode = NewMode();
        for (int i = 0; EnumDisplaySettings(null, i, ref mode); i++) {
            sizes.Add(mode.dmPelsWidth + "x" + mode.dmPelsHeight);
        }
        return string.Join(", ", sizes);
    }
}
'@

$before = [PvDisplay]::Apply($Width, $Height)
$actualWidth = [PvDisplay]::GetSystemMetrics(0)
$actualHeight = [PvDisplay]::GetSystemMetrics(1)
Write-Output "Display: $before before, ${actualWidth}x${actualHeight} after"
if ($actualWidth -ne $Width -or $actualHeight -ne $Height) {
    throw "The display is ${actualWidth}x${actualHeight}, not ${Width}x${Height}."
}

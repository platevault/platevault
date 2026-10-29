/**
 * The installed app's identity, read from the Tauri host (Settings ›
 * About, LIB-FR-21). Outside the desktop shell there is no installed app,
 * so the version reads `null`.
 */
import { getVersion } from "@tauri-apps/api/app"
import { inShell } from "./ipc"

/** The installed app's version, as its bundle declares it; `null` outside the desktop shell. */
export async function appVersion(): Promise<string | null> {
  return inShell() ? getVersion() : null
}

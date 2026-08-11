import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";

const GITHUB_REPO = "marcpadz/bard";
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export interface UpdateInfo {
  version: string;
  url: string;
  publishedAt: string;
  notes: string;
}

/** Semver compare. Returns >0 if a > b, 0 if equal, <0 if a < b. */
function compareVersions(a: string, b: string): number {
  const clean = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const av = clean(a);
  const bv = clean(b);
  for (let i = 0; i < 3; i++) {
    if ((av[i] ?? 0) !== (bv[i] ?? 0)) return (av[i] ?? 0) - (bv[i] ?? 0);
  }
  return 0;
}

/**
 * Fetch the latest GitHub release for this repo and report whether it's newer
 * than the running app version.
 */
export async function checkForUpdate(): Promise<{ available: boolean; info: UpdateInfo | null; error: string | null }> {
  try {
    const current = await getVersion();
    const res = await fetch(GITHUB_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      return { available: false, info: null, error: `Update check failed (HTTP ${res.status})` };
    }
    const data = await res.json();
    const tag = data.tag_name as string;
    if (!tag) return { available: false, info: null, error: "No releases found" };

    const info: UpdateInfo = {
      version: tag.replace(/^v/, ""),
      url: data.html_url as string,
      publishedAt: data.published_at as string,
      notes: (data.body as string) ?? "",
    };

    return {
      available: compareVersions(tag, current) > 0,
      info,
      error: null,
    };
  } catch (err) {
    return {
      available: false,
      info: null,
      error: err instanceof Error ? err.message : "Update check failed",
    };
  }
}

/**
 * Download the DMG for the given release version, install it in place, and
 * relaunch the app. The Rust side emits `update-downloaded` once the new app
 * is in place, at which point we trigger the relaunch.
 */
export async function downloadAndInstallUpdate(version: string): Promise<void> {
  const url = `https://github.com/${GITHUB_REPO}/releases/download/v${version}/Bard_${version}_aarch64.dmg`;
  await invoke("download_update", { url, version });
}

/** Resolve once the installed app signals it's ready to relaunch. */
export function onUpdateDownloaded(cb: () => void): Promise<() => void> {
  return listen("update-downloaded", cb);
}

import { join } from "node:path";

export const DESKTOP_APP_NAME = "HTML Mender";
export const DESKTOP_WORKSPACE_NAME = "HTML Mender 工作区";

export function resolveDesktopWorkspace({ desktopPath, env = process.env }) {
  const explicitDataDir = String(env.HTML_MENDER_DATA_DIR || "").trim();
  return explicitDataDir || join(desktopPath, DESKTOP_WORKSPACE_NAME);
}

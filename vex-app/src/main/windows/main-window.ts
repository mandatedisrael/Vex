/**
 * BrowserWindow factory z full security lockdown per skill §7.
 *
 * webPreferences locked: contextIsolation, sandbox, no nodeIntegration,
 * webSecurity, no insecure content, devTools only in dev builds, CJS preload.
 * Window state persisted via preferencesStore.
 */

import { BrowserWindow, app, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { preferencesStore } from "../preferences/store.js";
import { APP_ORIGIN } from "../protocol/app-protocol.js";
import {
  isAllowedExternalUrl,
  type ExternalAllowEntry,
} from "../security/url.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * External-link allowlist for shell.openExternal.
 * Each entry is a host (exact match) or {host, pathPrefix} (path-boundary match).
 * Default scheme: `https:` — http: never allowed externally.
 *
 * Path prefixes are matched with boundary respect: `/electron/electron/releases`
 * matches `/electron/electron/releases` and `/electron/electron/releases/...`,
 * NOT `/electron/electron/releases-malicious`. See `pathStartsWithBoundary`.
 */
const ALLOWED_EXTERNAL: ReadonlyArray<ExternalAllowEntry> = [
  "vex.ai",
  "docs.vex.ai",
  "portal.jup.ag",
  "openrouter.ai",
  "releases.electronjs.org",
  "desktop.docker.com",
  "docs.docker.com",
  // GitHub: restrict to Vex Foundation org + Electron releases (specific repos only)
  { host: "github.com", pathPrefix: "/Vex-Foundation/" },
  { host: "github.com", pathPrefix: "/electron/electron/releases" },
];

function checkExternalUrl(raw: string): boolean {
  return isAllowedExternalUrl(raw, ALLOWED_EXTERNAL);
}

function isAllowedAppUrl(raw: string): boolean {
  if (raw.startsWith(`${APP_ORIGIN}/`) || raw === APP_ORIGIN) return true;
  if (!app.isPackaged && raw.startsWith("http://127.0.0.1:5173/")) return true;
  return false;
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const prefs = await preferencesStore.load();

  const win = new BrowserWindow({
    width: prefs.window.width,
    height: prefs.window.height,
    x: prefs.window.x ?? undefined,
    y: prefs.window.y ?? undefined,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: "#0A0E27",
    title: "Vex",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      devTools: !app.isPackaged,
    },
  });

  if (prefs.window.maximized) win.maximize();

  // Window state persistence on close.
  const persistState = (): void => {
    if (win.isDestroyed()) return;
    const bounds = win.getNormalBounds();
    void preferencesStore.update({
      window: {
        width: bounds.width,
        height: bounds.height,
        x: bounds.x,
        y: bounds.y,
        maximized: win.isMaximized(),
      },
    });
  };
  win.on("close", persistState);

  // Block window.open + redirect to allowlisted external opener.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (checkExternalUrl(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Block in-window navigation to anything outside app://vex/ + dev server.
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedAppUrl(url)) {
      event.preventDefault();
      if (checkExternalUrl(url)) {
        void shell.openExternal(url);
      }
    }
  });

  // Show only after first paint (avoid white flash).
  win.once("ready-to-show", () => {
    win.show();
  });

  // Load renderer.
  if (app.isPackaged) {
    await win.loadURL(`${APP_ORIGIN}/index.html`);
  } else {
    await win.loadURL("http://127.0.0.1:5173/");
  }

  return win;
}

import "./styles/globals.css";
import "./vex.d.ts";

import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Missing #root");

createRoot(rootEl, {
  onCaughtError(error, info) {
    void window.vex?.telemetry?.reportRendererError({
      kind: "caught",
      message: String(error),
      componentStack: info.componentStack ?? null,
    });
  },
  onUncaughtError(error, info) {
    void window.vex?.telemetry?.reportRendererError({
      kind: "uncaught",
      message: String(error),
      componentStack: info.componentStack ?? null,
    });
  },
}).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

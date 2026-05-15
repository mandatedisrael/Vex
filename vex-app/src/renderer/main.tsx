import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/globals.css";

import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.js";
import { queryClient } from "./app/queryClient.js";

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
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { PnlCardDemoPage } from "./views/PnlCardDemoPage";
import "./index.css";

const searchParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
const DemoOrApp = searchParams?.get("demo") === "pnl-card" ? PnlCardDemoPage : App;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DemoOrApp />
  </StrictMode>,
);

/**
 * Sessions screen — the Sessions ShellScreen hosting the full session
 * register (SessionsLibrary). Row click closes the screen and opens the
 * session (SessionsLibrary wires that through the uiStore itself).
 */

import type { JSX } from "react";
import type { ShellScreenOrigin } from "../../../stores/uiStore.js";
import { SessionsLibrary } from "../SessionsLibrary.js";
import { ShellScreen } from "./ShellScreen.js";

export function SessionsScreen({
  origin,
  onClose,
}: {
  readonly origin: ShellScreenOrigin | null;
  readonly onClose: () => void;
}): JSX.Element {
  return (
    <ShellScreen title="Sessions" origin={origin} onClose={onClose}>
      <SessionsLibrary />
    </ShellScreen>
  );
}

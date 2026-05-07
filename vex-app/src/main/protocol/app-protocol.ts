/**
 * Custom app://vex/ protocol handler (post-Electron 25 protocol.handle API).
 *
 * Per skill §3, §7: avoid production file://; use a privileged custom scheme.
 * Schema must be registered as `privileged` BEFORE app.ready (see register()).
 *
 * Path safety: every URL is run through `resolveAppUrl` from
 * `../security/url.ts`, which handles traversal rejection, host check,
 * post-decode `..` detection, and asar-prefix containment.
 */

import { net, protocol } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveAppUrl } from "../security/url.js";

const SCHEME = "app";
const EXPECTED_HOST = "vex";

export function registerAppProtocolPrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
        corsEnabled: true,
        allowServiceWorkers: false,
        codeCache: true,
      },
    },
  ]);
}

export function installAppProtocolHandler(rendererRoot: string): void {
  const normalizedRoot = path.resolve(rendererRoot);

  protocol.handle(SCHEME, (request) => {
    const decision = resolveAppUrl({
      rawUrl: request.url,
      expectedHost: EXPECTED_HOST,
      normalizedRoot,
      resolve: path.resolve,
      sep: path.sep,
    });

    switch (decision.kind) {
      case "ok":
        return net.fetch(pathToFileURL(decision.absolutePath).toString());
      case "forbidden":
        return new Response("Forbidden", { status: 403 });
      case "not_found":
        return new Response("Not found", { status: 404 });
      case "bad_request":
        return new Response("Bad request", { status: 400 });
    }
  });
}

export const APP_ORIGIN = `${SCHEME}://${EXPECTED_HOST}`;

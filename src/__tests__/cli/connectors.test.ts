import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMcpOnboardingGuide } from "../../mcp/docs/onboarding.js";

const MOCK_MCP_ENTRY_PATH = "/tmp/echoclaw-test/dist/mcp/index.js";

vi.mock("../../cli/echo/package-assets.js", () => ({
  getMcpCliEntryPath: () => MOCK_MCP_ENTRY_PATH,
}));

const { readGeneratedArtifact, writeConnectorArtifacts } = await import("../../cli/echo/connectors.js");
const { buildQuickstartPrompt } = await import("../../cli/echo/quickstart.js");

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "echoclaw-connectors-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("echo connector generation", () => {
  it("writes ready artifacts for all supported AI agent targets", () => {
    const outputDir = createTempDir();
    const generated = writeConnectorArtifacts(outputDir);

    expect(generated.bundles.map((bundle) => bundle.id)).toEqual([
      "cursor",
      "claude",
      "codex",
      "openclaw",
      "default",
    ]);

    expect(existsSync(generated.readmePath)).toBe(true);
    expect(readGeneratedArtifact(join(outputDir, "cursor.mcp.json"))).toContain(`"command": "${process.execPath}"`);
    expect(readGeneratedArtifact(join(outputDir, "cursor.mcp.json"))).toContain(`"${MOCK_MCP_ENTRY_PATH}"`);
    expect(readGeneratedArtifact(join(outputDir, "claude.add-json.txt"))).toContain(
      "claude mcp add-json --scope local echoclaw",
    );
    expect(readGeneratedArtifact(join(outputDir, "codex.add.txt"))).toContain(
      "codex mcp add echoclaw --",
    );
    expect(readGeneratedArtifact(join(outputDir, "codex.add.txt"))).toContain(process.execPath);
    expect(readGeneratedArtifact(join(outputDir, "codex.add.txt"))).toContain(MOCK_MCP_ENTRY_PATH);
    expect(readGeneratedArtifact(join(outputDir, "openclaw.set.txt"))).toContain(
      "openclaw mcp set echoclaw",
    );
    expect(readGeneratedArtifact(join(outputDir, "default-http.txt"))).toContain(
      "http://127.0.0.1:4203/mcp",
    );
    expect(readGeneratedArtifact(join(outputDir, "quickstart.prompt.md"))).toBe(
      `${buildQuickstartPrompt()}\n`,
    );
  });

  it("builds a connector index readme with all target names", () => {
    const outputDir = createTempDir();
    const generated = writeConnectorArtifacts(outputDir);
    const readme = readFileSync(generated.readmePath, "utf-8");

    expect(readme).toContain("# EchoClaw MCP connectors");
    expect(readme).toContain("## Cursor");
    expect(readme).toContain("## Claude Code");
    expect(readme).toContain("## Codex");
    expect(readme).toContain("## OpenClaw");
    expect(readme).toContain("## Default MCP Client");
    expect(readme).toContain("## Quickstart");
    expect(readme).toContain("Prompt file: quickstart.prompt.md");
    expect(readme).toContain("Run In Shell");
    expect(readme).toContain("Paste Into AI");
    expect(readme).toContain(
      "You can run it in this same terminal after `echoclaw echo` exits, or open a second terminal if you prefer.",
    );
    expect(readme).toContain(buildQuickstartPrompt());
  });

  it("writes a quickstart prompt that follows the shared onboarding flow", () => {
    const guide = buildMcpOnboardingGuide();
    const prompt = buildQuickstartPrompt();

    expect(prompt).toContain(`${guide.internalToolCount} direct internal tools`);
    expect(prompt).toContain(`${guide.metaToolCount} meta tools`);
    expect(prompt).toContain(`${guide.protocolNamespaceCount} protocol namespaces`);
    expect(prompt.indexOf("docs://overview")).toBeLessThan(prompt.indexOf("docs://tools"));
    expect(prompt.indexOf("docs://tools")).toBeLessThan(prompt.indexOf("docs://protocols"));
    expect(prompt.indexOf("docs://protocols")).toBeLessThan(prompt.indexOf("docs://protocols/{namespace}"));
    expect(prompt.indexOf("docs://protocols/{namespace}")).toBeLessThan(prompt.indexOf("runtime://env"));
    expect(prompt).toContain("Do not scan every namespace by default");
    expect(prompt).toContain("knowledge_*");
    expect(prompt).toContain("document_*");
    expect(prompt).toContain("permission UX is the execution gate");
    expect(prompt).not.toContain("ALL 10 namespaces");
    expect(prompt).not.toContain("docs://routing");
    expect(prompt).not.toMatch(/Do not execute mutating tools, move funds, or write[\s\S]*knowledge\/documents/);
  });
});

import { app } from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";

export async function resolveContainedLogsDir(): Promise<string | null> {
  try {
    const userDataDir = app.getPath("userData");
    const logsDir = path.join(userDataDir, "logs");
    await fs.mkdir(logsDir, { recursive: true });
    const baseReal = await fs.realpath(userDataDir);
    const candidateReal = await fs.realpath(logsDir);
    const stat = await fs.stat(candidateReal);
    return stat.isDirectory() && candidateReal.startsWith(`${baseReal}${path.sep}`)
      ? candidateReal
      : null;
  } catch {
    return null;
  }
}

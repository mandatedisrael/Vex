import type { ProtocolToolManifest } from "../../../types.js";

export const IMAGE_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "slop-app.image.upload",
    namespace: "slop-app",
    lifecycle: "active",
    description: "Upload an image to IPFS via slop.money proxy. Returns CID and gateway URL. Max 5MB, jpg/png/gif.",
    mutating: true,
    params: [
      { key: "filePath", type: "string", required: true, description: "Absolute path to image file." },
    ],
    exampleParams: { filePath: "/tmp/avatar.png" },
  },
  {
    toolId: "slop-app.image.generate",
    namespace: "slop-app",
    lifecycle: "active",
    description: "Generate an AI image from a text prompt. Optionally upload to IPFS.",
    mutating: true,
    params: [
      { key: "prompt", type: "string", required: true, description: "Image generation prompt (max 1000 chars)." },
      { key: "upload", type: "boolean", description: "Upload generated image to IPFS." },
    ],
    exampleParams: { prompt: "minimalist robotic cat avatar", upload: true },
  },
];

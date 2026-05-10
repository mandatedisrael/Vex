/**
 * Generic "Step coming in MN" placeholder for wizard steps not yet
 * implemented in Phase 1. M7 ships only the Keystore step; M8–M11
 * fill the rest. Until then each step renders as an informational
 * card with no Continue affordance — preserves the wizard layout
 * + sidebar visualisation while making the not-yet-shipped surface
 * obvious.
 */

import type { JSX } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card.js";

const STEP_TITLES: Record<string, string> = {
  wallets: "Step 2 — Wallets",
  apiKeys: "Step 3 — API keys",
  embedding: "Step 4 — Embedding",
  agentCore: "Step 5 — Agent core",
  provider: "Step 6 — Provider",
  mode: "Step 7 — Mode",
  wake: "Step 8 — Wake",
  review: "Step 9 — Review",
};

export interface PlaceholderStepProps {
  readonly stepId: string;
  readonly milestone: "M8" | "M9" | "M10" | "M11";
}

export function PlaceholderStep({
  stepId,
  milestone,
}: PlaceholderStepProps): JSX.Element {
  const title = STEP_TITLES[stepId] ?? stepId;
  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Coming in {milestone}.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          This step is not yet implemented. The form will land here in
          milestone {milestone}; for now Step 1 (Master password) is the
          only interactive step. The wizard sidebar reflects your real
          progress, and any password you set is persisted across launches.
        </p>
      </CardContent>
    </Card>
  );
}

import type { Result } from "../../../ipc/result.js";
import type {
  HyperliquidPositionsDto,
  HyperliquidPositionsReadInput,
  HyperliquidCandlesDto,
  HyperliquidCandlesReadInput,
  HyperliquidCandleUpdateEvent,
  HyperliquidMarketsDto,
  HyperliquidMarketsReadInput,
  HyperliquidMidsUpdateEvent,
  HyperliquidBookDto,
  HyperliquidBookReadInput,
  HyperliquidRiskProposalConfirmInput,
  HyperliquidRiskProposalDto,
  HyperliquidSessionRiskPolicyDto,
  HyperliquidSessionRiskPolicyReadInput,
  HyperliquidSessionRiskPolicySetInput,
  HyperliquidRiskProposalsDto,
  HyperliquidRiskProposalsReadInput,
  HyperliquidWatchLiveInput,
  HyperliquidWatchLiveDto,
  HyperliquidUnwatchLiveInput,
  HyperliquidUnwatchLiveDto,
  HyperliquidWorkspaceEnterAccepted,
  HyperliquidWorkspaceEnterInput,
  HyperliquidWorkspaceExitInput,
  HyperliquidWorkspaceModeDto,
  HyperliquidWorkspaceModeReadInput,
  HyperliquidWorkspaceModeEvent,
} from "../../../schemas/hyperliquid.js";
import type { Preferences } from "../../../schemas/preferences.js";

/** Narrow, typed Hyperliquid bridge. Renderer never receives DB or exchange access. */
export interface HyperliquidBridge {
  readonly getPositions: (
    input: HyperliquidPositionsReadInput,
  ) => Promise<Result<HyperliquidPositionsDto>>;
  readonly getCandles: (
    input: HyperliquidCandlesReadInput,
  ) => Promise<Result<HyperliquidCandlesDto>>;
  readonly getMarkets: (
    input: HyperliquidMarketsReadInput,
  ) => Promise<Result<HyperliquidMarketsDto>>;
  readonly getBook: (
    input: HyperliquidBookReadInput,
  ) => Promise<Result<HyperliquidBookDto>>;
  readonly getWorkspaceMode: (
    input: HyperliquidWorkspaceModeReadInput,
  ) => Promise<Result<HyperliquidWorkspaceModeDto>>;
  readonly listRiskProposals: (
    input: HyperliquidRiskProposalsReadInput,
  ) => Promise<Result<HyperliquidRiskProposalsDto>>;
  readonly confirmRiskProposal: (
    input: HyperliquidRiskProposalConfirmInput,
  ) => Promise<Result<HyperliquidRiskProposalDto>>;
  readonly setSessionRiskPolicy: (
    input: HyperliquidSessionRiskPolicySetInput,
  ) => Promise<Result<HyperliquidRiskProposalDto>>;
  readonly getSessionRiskPolicy: (
    input: HyperliquidSessionRiskPolicyReadInput,
  ) => Promise<Result<HyperliquidSessionRiskPolicyDto>>;
  readonly acknowledgeRisk: () => Promise<Result<Preferences>>;
  /** Manual re-entry is main-gated by acknowledgement and prior entry. */
  readonly enterWorkspace: (
    input: HyperliquidWorkspaceEnterInput,
  ) => Promise<Result<HyperliquidWorkspaceEnterAccepted>>;
  /** Exit remains an always-manual, session-scoped action. */
  readonly exitWorkspace: (
    input: HyperliquidWorkspaceExitInput,
  ) => Promise<Result<HyperliquidWorkspaceModeEvent>>;
  /** Start a live candle+mids watch over main's shared SDK transport. */
  readonly watchLive: (
    input: HyperliquidWatchLiveInput,
  ) => Promise<Result<HyperliquidWatchLiveDto>>;
  readonly unwatchLive: (
    input: HyperliquidUnwatchLiveInput,
  ) => Promise<Result<HyperliquidUnwatchLiveDto>>;
  readonly onPositionsUpdate: (
    callback: (update: HyperliquidPositionsDto) => void,
  ) => () => void;
  readonly onRiskProposalUpdate: (
    callback: (proposal: HyperliquidRiskProposalDto) => void,
  ) => () => void;
  readonly onWorkspaceMode: (
    callback: (event: HyperliquidWorkspaceModeEvent) => void,
  ) => () => void;
  readonly onCandleUpdate: (
    callback: (event: HyperliquidCandleUpdateEvent) => void,
  ) => () => void;
  readonly onMidsUpdate: (
    callback: (event: HyperliquidMidsUpdateEvent) => void,
  ) => () => void;
}

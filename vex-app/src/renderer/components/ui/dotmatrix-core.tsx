import "../dotmatrix-loader/01-base.css";
import "../dotmatrix-loader/02-bloom-states.css";
import "../dotmatrix-loader/03-animation-classes.css";
import "../dotmatrix-loader/04-keyframes-core.css";
import "../dotmatrix-loader/05-square9.css";
import "../dotmatrix-loader/06-misc-variants.css";
import "../dotmatrix-loader/07-reduced-motion.css";

export type {
  DotAnimationContext,
  DotAnimationResolver,
  DotAnimationState,
  DotMatrixColorPreset,
  DotMatrixCommonProps,
  DotMatrixPhase,
  DotShape,
  MatrixPattern
} from "./dotmatrix-core/types.js";

export {
  CROSS_INDEXES,
  DIAMOND_INDEXES,
  FULL_INDEXES,
  getPatternIndexes,
  indexToCoord,
  MATRIX_SIZE,
  OUTLINE_INDEXES,
  RINGS_INDEXES,
  ROSE_INDEXES,
  rowMajorIndex
} from "./dotmatrix-core/patterns.js";

export {
  distanceFromCenter,
  harmonicPhase,
  isPrime,
  lissajousOffset,
  manhattanDistance,
  normalizedRadius,
  polarAngle,
  rowDistance,
  spiralOffset
} from "./dotmatrix-core/geometry.js";

export {
  colWaveNormFromIndex,
  concentricRingNormFromIndex,
  diagonalSnakeNormFromIndex,
  diagonalSnakeOrderValue,
  isWithinCircularMask,
  middleRingAntiClockwiseNormFromIndex,
  middleRingAntiClockwiseOrderValue,
  outerRingClockwiseNormFromIndex,
  outerRingClockwiseOrderValue,
  rowWaveNormFromIndex,
  rowWaveOrderValue,
  snakePathNormFromIndex,
  snakePathOrderValue,
  spiralInwardNormFromIndex,
  spiralInwardOrderValue,
  trBlPathNormFromIndex
} from "./dotmatrix-core/path-norms.js";

export { cx, styleOpacity, stylePx } from "./dotmatrix-core/util.js";

export { resolveDmxColorTokens } from "./dotmatrix-core/color.js";

export {
  DMX_BLOOM_OPACITY_MIN,
  dmxBloomHaloSpreadClass,
  dmxBloomRootActive,
  dmxDotBloomParts,
  opacityToBloomLevel,
  remapOpacityToTriplet,
  remappedOpacityQualifiesForBloom
} from "./dotmatrix-core/bloom.js";

export {
  createPathWaveComponent,
  createPathWaveResolver,
  DotMatrixBase
} from "./dotmatrix-core/base.js";

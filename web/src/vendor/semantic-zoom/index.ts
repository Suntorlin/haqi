// semantic-zoom-react: a React port of the Flutter package semantic_zoom
// by Roshen De Zoysa (MIT). https://github.com/Roshendz/semantic_zoom

export {
  LeveledText,
  type LeveledToken,
  type TokenStyle,
  type LeveledTransition,
  type LeveledVersionsReport,
  makeToken,
  isVisibleAt,
  isBreak,
  diffWords,
  tokenize,
  segmentWord,
  graphemes,
} from './core/leveled-text'
export {
  LeveledPrompt,
  buildLeveledPrompt,
  parseLeveledResponse,
  LeveledPromptFormatError,
  defaultLevelDescriptions,
  type LeveledPromptOptions,
} from './core/leveled-prompt'
export {
  SemanticZoomController,
  type SemanticZoomControllerOptions,
  type AnchorClient,
  type ZoomView,
  type FrameBatch,
} from './core/controller'
export { LeveledTextLoader } from './core/loader'
export {
  SpringSimulation,
  defaultSpring,
  springWithDampingRatio,
  zoomDefaults,
  rubberBand,
  zoomForScale,
  snapLevel,
  between,
  tokenOpacity,
  type SpringDescription,
} from './core/motion'

export { LeveledTextEngine, MeasureBatch, createMeasureBatch, type LevelLayout } from './dom/text-engine'
export { ScrollAnchor, ITEM_ATTR, type ScrollAnchorOptions } from './dom/scroll-anchor'
export { attachZoomGestures, type GestureOptions } from './dom/gestures'

export {
  SemanticZoomContext,
  useSemanticZoom,
  useSemanticZoomController,
  useZoomLevel,
  useItemLevel,
  useIsPinching,
  type UseSemanticZoomControllerOptions,
} from './react/hooks'
export { LeveledTextView, type LeveledTextViewProps } from './react/LeveledTextView'
export {
  SemanticZoomList,
  SemanticZoomGrid,
  SemanticZoomProvider,
  useSemanticZoomScroller,
  type SemanticZoomListProps,
  type SemanticZoomGridProps,
  type UseSemanticZoomScrollerOptions,
} from './react/SemanticZoomList'
export { LevelSwitcher, type LevelSwitcherProps } from './react/LevelSwitcher'
export {
  ExpandableLeveledText,
  type ExpandableLeveledTextProps,
  type ExpandableLeveledTextHandle,
} from './react/ExpandableLeveledText'
export { LazyLeveledTextView, type LazyLeveledTextViewProps } from './react/LazyLeveledTextView'

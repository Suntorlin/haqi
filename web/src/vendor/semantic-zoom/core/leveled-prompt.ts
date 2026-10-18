// Port of lib/src/leveled_prompt.dart (semantic_zoom, (c) Roshen De Zoysa,
// MIT). Pure functions only: no model calls. See docs/behavior.md R-25..R-27.

export interface LeveledPromptOptions {
  /** The text to summarise. */
  source: string
  /** Number of versions to ask for. At least 2. */
  levels?: number
  /** One description per level. Defaults to `defaultLevelDescriptions`, stretched. */
  levelDescriptions?: readonly string[]
  /** Extra guidance such as tone, audience or language. */
  instructions?: string
}

/** Default description of each level, by position. */
export const defaultLevelDescriptions = [
  'a title of at most 6 words',
  'one sentence of at most 25 words',
  'the complete text',
] as const

// Each line only inserts words into the one before it.
// (The original package uses a medical example here; this port uses travel.)
const EXAMPLE = [
  'Train to Porto',
  'Train to Porto along the coast, window seat',
  'Train to Porto along the coast in three hours, window seat on the left.',
  'Train to Porto along the Atlantic coast in three hours, window seat on ' +
    'the left as the inspector advised.',
]

function descriptionsFor(levels: number): string[] {
  const out: string[] = []
  for (let i = 0; i < levels; i++) {
    if (i === 0) out.push(defaultLevelDescriptions[0])
    else if (i === levels - 1) out.push(defaultLevelDescriptions[2])
    else out.push(levels === 3 ? defaultLevelDescriptions[1] : `a summary of about ${25 * i} words`)
  }
  return out
}

/** A prompt asking for `levels` versions of `source`, briefest first, returned as JSON. */
export function buildLeveledPrompt(opts: LeveledPromptOptions): string {
  const levels = opts.levels ?? 3
  if (!Number.isInteger(levels) || levels < 2) throw new RangeError('levels must be at least 2')
  if (opts.levelDescriptions && opts.levelDescriptions.length !== levels) {
    throw new RangeError(`levelDescriptions must have ${levels} entries`)
  }
  const descriptions = opts.levelDescriptions ?? descriptionsFor(levels)

  const lines: string[] = [
    `Write ${levels} versions of the source text below, from shortest to ` +
      'longest, for an app where readers pinch to see more or less ' +
      'detail. Each longer version grows out of the shorter one so its ' +
      'words can animate into place.',
    '',
    'Versions:',
  ]
  for (let i = 0; i < levels; i++) lines.push(`${i + 1}. ${descriptions[i]}`)
  lines.push(
    '',
    'Rules:',
    '- Every version must contain all words of the version before it, ' +
      'in the same order, with the same spelling, capitalisation and ' +
      'punctuation. Only insert new words between them. Never remove, ' +
      'reorder or rephrase a word.',
    '- Use only information from the source. Do not add facts, opinions or advice.',
    '- Plain sentences. You may mark key terms as **bold**. No headings, lists or emojis.',
  )
  const extra = opts.instructions?.trim()
  if (extra) lines.push(`- ${extra}`)
  lines.push(
    '- Reply with JSON only, no other text: {"levels": ["version 1", "version 2", ...]}',
    '',
    'Example of the growth pattern:',
    JSON.stringify({ levels: EXAMPLE.slice(0, levels) }),
    '',
    'Source:',
    '"""',
    opts.source.trim(),
  )
  return lines.join('\n') + '\n"""'
}

/** Thrown by `parseLeveledResponse` when no list of strings can be found. */
export class LeveledPromptFormatError extends Error {
  readonly response: string
  constructor(message: string, response: string) {
    super(message)
    this.name = 'LeveledPromptFormatError'
    this.response = response
  }
}

function firstOf(s: string, chars: string[]): number {
  let best = -1
  for (const c of chars) {
    const i = s.indexOf(c)
    if (i !== -1 && (best === -1 || i < best)) best = i
  }
  return best
}

function lastOf(s: string, chars: string[]): number {
  let best = -1
  for (const c of chars) best = Math.max(best, s.lastIndexOf(c))
  return best
}

/**
 * Extracts the versions from an LLM reply. Accepts `{"levels": [...]}` or a
 * bare JSON array, optionally inside a ```json fence or surrounded by other
 * text. Throws `LeveledPromptFormatError` otherwise.
 */
export function parseLeveledResponse(response: string): string[] {
  const start = firstOf(response, ['{', '['])
  const end = lastOf(response, ['}', ']'])
  if (start === -1 || end < start) throw new LeveledPromptFormatError('No JSON found in the response', response)
  let decoded: unknown
  try {
    decoded = JSON.parse(response.substring(start, end + 1))
  } catch (e) {
    throw new LeveledPromptFormatError(`Invalid JSON: ${(e as Error).message}`, response)
  }
  const list =
    decoded && typeof decoded === 'object' && !Array.isArray(decoded)
      ? (decoded as Record<string, unknown>).levels
      : decoded
  if (!Array.isArray(list) || list.length === 0 || list.some((e) => typeof e !== 'string')) {
    throw new LeveledPromptFormatError('Expected {"levels": [...]} with a list of strings', response)
  }
  return (list as string[]).map((e) => e.trim())
}

/** Namespace mirroring the Dart `LeveledPrompt` class. */
export const LeveledPrompt = {
  defaultLevelDescriptions,
  build: buildLeveledPrompt,
  parseResponse: parseLeveledResponse,
} as const

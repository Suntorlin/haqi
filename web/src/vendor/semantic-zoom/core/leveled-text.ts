// Port of lib/src/leveled_text.dart from the Flutter package semantic_zoom
// (c) Roshen De Zoysa, MIT. See docs/behavior.md R-01..R-24.

/** Inline style of a token. */
export interface TokenStyle {
  bold?: boolean
  italic?: boolean
}

/**
 * A word (or glued punctuation) tagged with the range of detail levels at
 * which it is visible, plus optional styling and a link.
 */
export interface LeveledToken {
  /** The word, or `'\n'` for a paragraph break. */
  readonly text: string
  /** Lowest level (0 = briefest) at which this token is shown. */
  readonly minLevel: number
  /**
   * Highest level at which this token is shown, or `null` if it stays
   * visible at every level above `minLevel`. Set when a longer version
   * rewrites (drops) this word; it then fades out.
   */
  readonly maxLevel: number | null
  /** Attaches to the previous token with no space, e.g. a comma. */
  readonly glued: boolean
  readonly style: TokenStyle | null
  /** Link target, passed to `onLinkTap`. */
  readonly link: string | null
}

export function makeToken(
  text: string,
  minLevel: number,
  opts: { maxLevel?: number | null; glued?: boolean; style?: TokenStyle | null; link?: string | null } = {},
): LeveledToken {
  const maxLevel = opts.maxLevel ?? null
  if (minLevel < 0) throw new RangeError('minLevel must be >= 0')
  if (maxLevel !== null && maxLevel < minLevel) throw new RangeError('maxLevel must be >= minLevel')
  return Object.freeze({
    text,
    minLevel,
    maxLevel,
    glued: opts.glued ?? false,
    style: opts.style ?? null,
    link: opts.link ?? null,
  })
}

export const paragraphBreak: LeveledToken = makeToken('\n', 0)

export const isBreak = (t: LeveledToken): boolean => t.text === '\n'

export const isVisibleAt = (t: LeveledToken, level: number): boolean =>
  level >= t.minLevel && (t.maxLevel === null || level <= t.maxLevel)

const sameStyle = (a: TokenStyle | null, b: TokenStyle | null) =>
  a === b || (!!a && !!b && !!a.bold === !!b.bold && !!a.italic === !!b.italic)

export const tokensEqual = (a: LeveledToken, b: LeveledToken): boolean =>
  a.text === b.text &&
  a.minLevel === b.minLevel &&
  a.maxLevel === b.maxLevel &&
  a.glued === b.glued &&
  sameStyle(a.style, b.style) &&
  a.link === b.link

/** How smoothly a set of versions will morph. See `LeveledText.checkVersions`. */
export interface LeveledTransition {
  /** The shorter level; the longer one is `fromLevel + 1`. */
  fromLevel: number
  /** Words of the shorter level that stay on screen and slide. */
  kept: number
  /** Words the longer level adds. */
  added: number
  /** Words of the shorter level that the longer one drops (they cross-fade). */
  dropped: string[]
  /** Share of the shorter level's words that carry over, 0..1. */
  carryOver: number
}

export interface LeveledVersionsReport {
  transitions: LeveledTransition[]
  /** Human-readable warnings, empty when everything looks good. */
  issues: string[]
  /** Every longer version only adds words (StretchText contract). */
  isStrict: boolean
  /** Lowest carry-over between two levels, 0..1. */
  smoothness: number
}

/**
 * Text that exists at several detail levels, stored as a single token
 * stream (R-01).
 */
export class LeveledText {
  /** The token stream, in reading order. */
  readonly tokens: readonly LeveledToken[]
  /** Highest level at which the text differs from the level below it. */
  readonly maxLevel: number
  /** Levels at which some words are replaced rather than only added (R-42). */
  readonly rewrittenLevels: ReadonlySet<number>

  constructor(tokens: readonly LeveledToken[]) {
    this.tokens = Object.freeze([...tokens])
    let m = 0
    const rewritten = new Set<number>()
    for (const t of tokens) {
      const top = t.maxLevel === null ? t.minLevel : t.maxLevel + 1
      if (top > m) m = top
      if (t.maxLevel !== null) rewritten.add(t.maxLevel + 1)
    }
    this.maxLevel = m
    this.rewrittenLevels = rewritten
  }

  /**
   * Parses markup where plain words are level 0, `[words]` are level 1,
   * `{words}` are level 2, and `\n` is a paragraph break (R-06..R-10).
   * Throws `SyntaxError` on unbalanced or nested level brackets.
   */
  static parse(markup: string): LeveledText {
    return new LeveledText(
      scan(markup, true).map((r) =>
        r.text === '\n'
          ? paragraphBreak
          : makeToken(r.text, r.level, { glued: r.glued, style: r.style, link: r.link }),
      ),
    )
  }

  /**
   * Builds leveled text from plain versions, briefest first (R-15..R-20).
   * Shared words slide; added words fade in; dropped words fade out.
   */
  static fromVersions(versions: readonly string[], opts: { requireSubsequence?: boolean } = {}): LeveledText {
    return new LeveledText(fromVersionsTokens(versions, opts.requireSubsequence ?? false))
  }

  /** Reports how smoothly `versions` will morph (R-21..R-24). */
  static checkVersions(versions: readonly string[]): LeveledVersionsReport {
    return check(versions)
  }

  /** The text shown at `level`, paragraphs joined with `\n`, without markup (R-04). */
  textAt(level: number): string {
    let out = ''
    let pendingBreak = false
    for (const t of this.tokens) {
      if (!isVisibleAt(t, level)) continue
      if (isBreak(t)) {
        pendingBreak = out.length > 0
        continue
      }
      if (pendingBreak) {
        out += '\n'
        pendingBreak = false
      } else if (out.length > 0 && !t.glued) {
        out += ' '
      }
      out += t.text
    }
    return out
  }

  equals(other: LeveledText): boolean {
    if (other === this) return true
    if (other.tokens.length !== this.tokens.length) return false
    return this.tokens.every((t, i) => tokensEqual(t, other.tokens[i]))
  }
}

// ───────────────────────────── scanning ─────────────────────────────

interface Raw {
  text: string
  glued: boolean
  level: number
  style: TokenStyle | null
  link: string | null
}

const PUNCTUATION = '.,;:!?…'
// Only used for checkVersions' word counts.
const CJK_PUNCTUATION = '。、，．！？；：「」『』（）【】〈〉《》…・〜ー'

const isPunctuationText = (s: string) =>
  [...s].every((c) => PUNCTUATION.includes(c) || CJK_PUNCTUATION.includes(c))

const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\r'
const isWhite = (ch: string) => isSpace(ch) || ch === '\n'

/**
 * Scripts written without spaces between words (R-11). Each grapheme of
 * these becomes its own token, so a sentence can morph and wrap per character.
 */
export function isUnspaced(cp: number): boolean {
  return (
    (cp >= 0x0e00 && cp <= 0x0eff) || // Thai, Lao
    (cp >= 0x1000 && cp <= 0x109f) || // Myanmar
    (cp >= 0x1780 && cp <= 0x17ff) || // Khmer
    (cp >= 0x19e0 && cp <= 0x19ff) || // Khmer symbols
    (cp >= 0x2e80 && cp <= 0x2fdf) || // CJK and Kangxi radicals
    (cp >= 0x3000 && cp <= 0x30ff) || // CJK punctuation, kana
    (cp >= 0x3100 && cp <= 0x312f) || // Bopomofo
    (cp >= 0x31a0 && cp <= 0x31ff) || // Bopomofo ext, kana ext
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified ideographs
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility
    (cp >= 0xff00 && cp <= 0xffef) || // full/halfwidth forms
    (cp >= 0x20000 && cp <= 0x3134f) // CJK ext B-G
  )
}

type Segmenter = { segment(s: string): Iterable<{ segment: string }> }
let graphemeSegmenter: Segmenter | null | undefined

/** Grapheme clusters via `Intl.Segmenter`, falling back to code points. */
export function graphemes(s: string): string[] {
  if (graphemeSegmenter === undefined) {
    const Ctor = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => Segmenter }).Segmenter
    graphemeSegmenter = Ctor ? new Ctor(undefined, { granularity: 'grapheme' }) : null
  }
  if (!graphemeSegmenter) return Array.from(s)
  const out: string[] = []
  for (const { segment } of graphemeSegmenter.segment(s)) out.push(segment)
  return out
}

/**
 * Splits a space-free word into tokens: one per grapheme of an unspaced
 * script, with runs of anything else (Latin, digits, emoji) kept whole.
 */
export function segmentWord(word: string): string[] {
  let any = false
  for (const ch of word) {
    if (isUnspaced(ch.codePointAt(0)!)) {
      any = true
      break
    }
  }
  if (!any) return [word]
  const parts: string[] = []
  let run = ''
  for (const g of graphemes(word)) {
    if (isUnspaced(g.codePointAt(0)!)) {
      if (run) {
        parts.push(run)
        run = ''
      }
      parts.push(g)
    } else {
      run += g
    }
  }
  if (run) parts.push(run)
  return parts
}

/** `[label](url)` starting at `i`: [index of `]`, index after `)`, url]. */
function linkAt(s: string, i: number): [number, number, string] | null {
  let j = i + 1
  while (j < s.length && s[j] !== ']') {
    if (s[j] === '[' || s[j] === '\n') return null
    j++
  }
  if (j >= s.length || j === i + 1) return null
  if (j + 1 >= s.length || s[j + 1] !== '(') return null
  let k = j + 2
  while (k < s.length && s[k] !== ')') {
    if (isWhite(s[k])) return null
    k++
  }
  if (k >= s.length || k === j + 2) return null
  return [j, k + 1, s.substring(j + 2, k)]
}

/**
 * Splits `src` into words, glued punctuation and paragraph breaks, reading
 * inline markup. With `levels`, `[..]` and `{..}` set levels 1 and 2.
 */
function scan(src: string, levels: boolean): Raw[] {
  const out: Raw[] = []
  let buf = ''
  let bufIsPunct = false
  let level = 0
  let openedBy: string | null = null
  let bold = false
  let italic = false
  let link: string | null = null
  let linkLabelEnd = -1
  let linkEnd = -1
  let sawSpace = true
  let glued = false

  const style = (): TokenStyle | null =>
    bold || italic ? { ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}) } : null

  const flush = () => {
    if (!buf) return
    let first = true
    for (const part of segmentWord(buf)) {
      out.push({ text: part, glued: first ? glued : true, level, style: style(), link })
      first = false
    }
    buf = ''
  }

  const write = (ch: string, punct: boolean) => {
    // Punctuation is its own glued token, so versions compare word by word.
    if (buf && bufIsPunct !== punct) flush()
    if (!buf) {
      glued = !sawSpace && out.length > 0
      sawSpace = false
      bufIsPunct = punct
    }
    buf += ch
  }

  const open = (ch: string, lvl: number, at: number) => {
    if (openedBy !== null) throw new SyntaxError(`Nested "${ch}" inside "${openedBy}" at ${at}`)
    flush()
    openedBy = ch
    level = lvl
  }

  const close = (expectedOpen: string, ch: string, at: number) => {
    if (openedBy !== expectedOpen) throw new SyntaxError(`Unmatched "${ch}" at ${at}`)
    flush()
    openedBy = null
    level = 0
  }

  let i = 0
  while (i < src.length) {
    const ch = src[i]

    if (ch === '\\' && i + 1 < src.length && src[i + 1] !== '\n') {
      write(src[i + 1], false)
      i += 2
      continue
    }

    if (ch === '*') {
      const isDouble = i + 1 < src.length && src[i + 1] === '*'
      const len = isDouble ? 2 : 1
      const opening = isDouble ? !bold : !italic
      const before = i > 0 ? src[i - 1] : ' '
      const after = i + len < src.length ? src[i + len] : ' '
      // Like Markdown: an opening delimiter must touch the next word and a
      // closing one the previous word, so "5 * 3" stays literal (R-08).
      if (opening ? !isWhite(after) : !isWhite(before)) {
        flush()
        if (isDouble) bold = !bold
        else italic = !italic
        i += len
        continue
      }
      for (let k = 0; k < len; k++) write('*', false)
      i += len
      continue
    }

    if (ch === '[' && link === null) {
      const found = linkAt(src, i)
      if (found) {
        flush()
        ;[linkLabelEnd, linkEnd, link] = found
        i++
        continue
      }
    }
    if (link !== null && i === linkLabelEnd) {
      flush()
      link = null
      i = linkEnd
      continue
    }

    if (levels) {
      if (ch === '[') {
        open(ch, 1, i)
        i++
        continue
      }
      if (ch === '{') {
        open(ch, 2, i)
        i++
        continue
      }
      if (ch === ']') {
        close('[', ch, i)
        i++
        continue
      }
      if (ch === '}') {
        close('{', ch, i)
        i++
        continue
      }
    }

    if (isSpace(ch)) {
      flush()
      sawSpace = true
    } else if (ch === '\n') {
      flush()
      out.push({ text: '\n', glued: false, level: 0, style: null, link: null })
      sawSpace = true
    } else {
      write(ch, PUNCTUATION.includes(ch))
    }
    i++
  }
  if (openedBy !== null) throw new SyntaxError(`Unclosed "${openedBy}"`)
  flush()
  return out
}

/** Exposed for tests and for callers that want the raw word split. */
export function tokenize(src: string): string[] {
  return scan(src, false).map((r) => r.text)
}

// ───────────────────────────── versions ─────────────────────────────

const enum Op {
  Keep,
  Delete,
  Insert,
}

export type DiffOp = ['keep' | 'delete' | 'insert', number, number]

/**
 * Word-level LCS diff (R-17). Returns [op, index in a, index in b]; deletes
 * come before inserts in a changed region so old words sit before new ones.
 */
export function diffWords(a: readonly string[], b: readonly string[]): DiffOp[] {
  return diff(a, b).map(([op, i, j]) => [op === Op.Keep ? 'keep' : op === Op.Delete ? 'delete' : 'insert', i, j])
}

function diff(a: readonly string[], b: readonly string[]): [Op, number, number][] {
  const n = a.length
  const m = b.length
  const w = m + 1
  // lcs[i * w + j] = LCS length of a[i..] and b[j..].
  const lcs = new Int32Array((n + 1) * w)
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] =
        a[i] === b[j]
          ? lcs[(i + 1) * w + j + 1] + 1
          : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1])
    }
  }
  const ops: [Op, number, number][] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      ops.push([Op.Keep, i++, j++])
    } else if (j >= m || (i < n && lcs[(i + 1) * w + j] >= lcs[i * w + j + 1])) {
      ops.push([Op.Delete, i++, -1])
    } else {
      ops.push([Op.Insert, -1, j++])
    }
  }
  return ops
}

function fromVersionsTokens(versions: readonly string[], requireSubsequence: boolean): LeveledToken[] {
  if (versions.length === 0) throw new RangeError('versions must not be empty')

  const token = (r: Raw, level: number) =>
    r.text === '\n' ? paragraphBreak : makeToken(r.text, level, { glued: r.glued, style: r.style, link: r.link })

  let stream: LeveledToken[] = scan(versions[0], false).map((r) => token(r, 0))

  for (let v = 1; v < versions.length; v++) {
    const next = scan(versions[v], false)
    const alive: number[] = []
    for (let i = 0; i < stream.length; i++) if (stream[i].maxLevel === null) alive.push(i)
    const ops = diff(
      alive.map((i) => stream[i].text),
      next.map((r) => r.text),
    )

    if (requireSubsequence) {
      const dropped = ops.find((o) => o[0] === Op.Delete)
      if (dropped) {
        throw new RangeError(
          `Version ${v} is not a word-superset of version ${v - 1}: ` +
            `"${stream[alive[dropped[1]]].text}" is missing or out of order. ` +
            'Pass requireSubsequence: false to cross-fade rewritten words.',
        )
      }
    }

    // Rebuild the stream, keeping tokens that died at earlier levels in
    // their place relative to the live ones (R-16).
    const merged: LeveledToken[] = []
    let cursor = 0
    const copyDeadUpTo = (index: number) => {
      while (cursor < index) merged.push(stream[cursor++])
    }
    for (const [op, a, b] of ops) {
      if (op === Op.Keep) {
        copyDeadUpTo(alive[a])
        merged.push(stream[cursor++])
      } else if (op === Op.Delete) {
        copyDeadUpTo(alive[a])
        const t = stream[cursor++]
        merged.push(makeToken(t.text, t.minLevel, { maxLevel: v - 1, glued: t.glued, style: t.style, link: t.link }))
      } else {
        merged.push(token(next[b], v))
      }
    }
    copyDeadUpTo(stream.length)
    stream = merged
  }
  return stream
}

function check(versions: readonly string[]): LeveledVersionsReport {
  const issues: string[] = []
  const transitions: LeveledTransition[] = []
  if (versions.length < 2) issues.push('Provide at least two versions to morph between.')

  const scanned = versions.map((v) => scan(v, false).filter((r) => r.text !== '\n'))
  scanned.forEach((s, i) => {
    if (s.length === 0) issues.push(`Level ${i} is empty.`)
  })

  for (let v = 1; v < scanned.length; v++) {
    const a = scanned[v - 1]
    const b = scanned[v]
    const ops = diff(
      a.map((r) => r.text),
      b.map((r) => r.text),
    )
    let kept = 0
    let added = 0
    const dropped: string[] = []
    for (const [op, ai, bi] of ops) {
      if (op === Op.Keep) {
        if (!isPunctuationText(a[ai].text)) kept++
      } else if (op === Op.Delete) {
        if (!isPunctuationText(a[ai].text)) dropped.push(a[ai].text)
      } else if (!isPunctuationText(b[bi].text)) {
        added++
      }
    }
    const total = kept + dropped.length
    const carryOver = total === 0 ? 1 : kept / total
    transitions.push({ fromLevel: v - 1, kept, added, dropped, carryOver })

    if (added === 0 && dropped.length === 0) issues.push(`Level ${v} adds nothing to level ${v - 1}.`)
    if (dropped.length > 0) {
      const shown = dropped
        .slice(0, 5)
        .map((w) => `"${w}"`)
        .join(', ')
      const more = dropped.length > 5 ? ', …' : ''
      issues.push(
        `Level ${v} drops ${dropped.length} word${dropped.length === 1 ? '' : 's'} ` +
          `of level ${v - 1} (${shown}${more}); they will cross-fade.`,
      )
    }
    if (carryOver < 0.5) {
      issues.push(
        `Level ${v} keeps only ${Math.round(carryOver * 100)}% of level ${v - 1}; ` +
          'the change will look like a cross-fade, not a stretch.',
      )
    }
  }
  return {
    transitions,
    issues,
    isStrict: transitions.every((t) => t.dropped.length === 0),
    smoothness: transitions.length === 0 ? 1 : Math.min(...transitions.map((t) => t.carryOver)),
  }
}

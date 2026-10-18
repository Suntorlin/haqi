// Port of lib/src/leveled_text_loader.dart (semantic_zoom, (c) Roshen De
// Zoysa, MIT). See docs/behavior.md R-70.

import { LeveledText } from './leveled-text'

/**
 * Leveled text whose longer versions are fetched only when needed: the brief
 * text is available at once, and the rest is loaded (from an API or an LLM)
 * the first time someone expands it. Keep loaders with your data, not in
 * render, so a result is fetched once and reused.
 */
export class LeveledTextLoader {
  private _text: LeveledText
  private _isLoaded: boolean
  private _pending: Promise<void> | null = null
  private _error: unknown = null
  private _disposed = false
  private readonly _load: (() => Promise<LeveledText>) | null
  private readonly _listeners = new Set<() => void>()

  constructor(opts: { brief: LeveledText; load: () => Promise<LeveledText> }) {
    this._text = opts.brief
    this._load = opts.load
    this._isLoaded = false
  }

  /** Plain versions: `brief` first, then the longer ones returned by `load`, briefest first. */
  static versions(opts: {
    brief: string
    load: () => Promise<readonly string[]>
    requireSubsequence?: boolean
  }): LeveledTextLoader {
    return new LeveledTextLoader({
      brief: LeveledText.fromVersions([opts.brief]),
      load: async () =>
        LeveledText.fromVersions([opts.brief, ...(await opts.load())], {
          requireSubsequence: opts.requireSubsequence,
        }),
    })
  }

  /** A loader whose text is already complete; nothing is fetched. */
  static loaded(text: LeveledText): LeveledTextLoader {
    const l = new LeveledTextLoader({ brief: text, load: async () => text })
    l._isLoaded = true
    return l
  }

  /** The brief text until loading completes, then the full text. */
  get text(): LeveledText {
    return this._text
  }
  get isLoaded(): boolean {
    return this._isLoaded
  }
  get isLoading(): boolean {
    return this._pending !== null
  }
  /** The error from the last failed load, or null. Cleared on retry. */
  get error(): unknown {
    return this._error
  }

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  private _notify() {
    for (const l of [...this._listeners]) l()
  }

  /**
   * Loads the longer versions once. Concurrent calls share one load; after a
   * failure, calling it again retries. Never rejects: failures go to `error`.
   */
  ensureLoaded(): Promise<void> {
    if (this._isLoaded || !this._load) return Promise.resolve()
    this._pending ??= this._run()
    return this._pending
  }

  private async _run(): Promise<void> {
    // Yield first so isLoading is already true when listeners hear about it.
    await null
    if (this._disposed) return
    this._error = null
    this._notify()
    try {
      const full = await this._load!()
      if (this._disposed) return
      this._text = full
      this._isLoaded = true
    } catch (e) {
      if (this._disposed) return
      this._error = e ?? new Error('Load failed')
    } finally {
      this._pending = null
      if (!this._disposed) this._notify()
    }
  }

  dispose(): void {
    this._disposed = true
    this._listeners.clear()
  }
}

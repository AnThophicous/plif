/**
 * Small, deterministic language model for the composer.
 *
 * This deliberately stays local. It learns word transitions from the current
 * session and combines them with a tiny product vocabulary, so suggestions
 * become contextual without sending every keystroke to a provider. It is a
 * predictor only: it never rewrites a draft by itself.
 */

export interface LocalAssistanceSettings {
  readonly autocomplete: boolean;
  readonly language: string;
}

export type LocalSuggestionKind = 'autocomplete' | 'prediction';
export type LocalSuggestionSource = 'context' | 'history' | 'project' | 'dictionary';

export interface LocalSuggestion {
  /** The complete word shown to the user, without an implicit trailing space. */
  readonly value: string;
  /** The exact text inserted when Tab accepts this suggestion. */
  readonly replacement: string;
  /** UTF-16 span replaced by replacement. */
  readonly start: number;
  readonly end: number;
  readonly kind: LocalSuggestionKind;
  readonly source: LocalSuggestionSource;
  readonly score: number;
}

export interface LocalSuggestionContext {
  readonly settings?: Partial<LocalAssistanceSettings>;
  readonly history?: readonly string[];
  /** Kept as a context source for slash-command-aware callers. */
  readonly commands?: readonly string[];
  readonly projectVocabulary?: readonly string[];
}

const DEFAULT_SETTINGS: LocalAssistanceSettings = {
  autocomplete: true,
  language: 'en',
};

const MAX_SUGGESTIONS = 4;
const WORD_PATTERN = /[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*/gu;
const WORD_PREFIX_PATTERN = /[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]*)*$/u;

// The dictionary is intentionally compact. History and project vocabulary are
// weighted more heavily, which makes this useful for the user's actual work
// instead of pretending a generic word list knows their product.
const ENGLISH_WORDS = [
  'a', 'about', 'after', 'agent', 'all', 'and', 'another', 'any', 'apply', 'are',
  'ask', 'at', 'before', 'build', 'by', 'call', 'can', 'change', 'check', 'code',
  'command', 'complete', 'component', 'configure', 'connect', 'context', 'continue',
  'create', 'current', 'database', 'debug', 'delete', 'describe', 'does', 'each',
  'edit', 'error', 'example', 'feature', 'file', 'find', 'first', 'fix', 'for',
  'from', 'get', 'give', 'go', 'has', 'have', 'help', 'here', 'how', 'if', 'in',
  'include', 'install', 'into', 'is', 'it', 'just', 'last', 'list', 'load', 'make',
  'memory', 'model', 'more', 'move', 'must', 'new', 'next', 'not', 'now', 'of',
  'on', 'once', 'only', 'open', 'or', 'other', 'our', 'out', 'package', 'path',
  'please', 'project', 'read', 'remove', 'replace', 'request', 'review', 'run',
  'save', 'send', 'set', 'show', 'start', 'stop', 'store', 'task', 'test', 'that',
  'the', 'their', 'then', 'there', 'this', 'through', 'to', 'tool', 'update', 'use',
  'user', 'value', 'verify', 'version', 'was', 'with', 'without', 'work', 'workspace',
  'write', 'you', 'your',
] as const;

/**
 * Seed transitions make the first few prompts useful, while the session model
 * quickly takes precedence once the user has a history of their own.
 */
const CONTEXT_CORPUS = [
  'please build the interface',
  'please build the component',
  'please fix the failing test',
  'please review the changes',
  'please show me the result',
  'can you explain the error',
  'can you update the configuration',
  'run the tests',
  'run the typecheck',
  'check the current status',
  'check the project files',
  'look at the latest changes',
  'create a new component',
  'create a focused implementation',
  'update the documentation',
  'make it more accessible',
  'make the animation feel intentional',
  'use the project vocabulary',
  'read the relevant file',
  'find the source of the error',
  'verify the result',
] as const;

interface CandidateStats {
  frequency: number;
  source: LocalSuggestionSource;
}

interface LanguageModel {
  readonly candidates: Map<string, CandidateStats>;
  readonly bigrams: Map<string, Map<string, number>>;
  readonly trigrams: Map<string, Map<string, number>>;
}

interface CursorToken {
  readonly fragment: string;
  readonly start: number;
  readonly end: number;
}

function normalizeWord(value: string): string {
  return value.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
}

function wordsIn(text: string): readonly string[] {
  return rawWordsIn(text)
    .map((word) => normalizeWord(word))
    .filter((word) => word.length >= 2);
}

/** The same tokens before normalisation, so case-sensitive guards still work. */
function rawWordsIn(text: string): readonly string[] {
  return [...text.matchAll(WORD_PATTERN)].map((match) => match[0] ?? '');
}

/**
 * Shapes that must never become a learned completion.
 *
 * Checked against the token as it was typed: lowercasing first hides the
 * screaming-case spelling that identifies an environment variable, which is
 * why the guard used to be a blanket ban on the underscore instead - and that
 * ban also threw away every snake_case name the user actually wanted back.
 */
function unlearnable(raw: string): boolean {
  if (/^(?:sk|pk|ghp|github_pat|xox[baprs]-)/iu.test(raw)) return true;
  if (/^[A-Z][A-Z0-9_]*$/u.test(raw) && /[_\d]/u.test(raw)) return true;
  return false;
}

function lineBefore(text: string, position: number): string {
  const lineStart = text.lastIndexOf('\n', Math.max(0, position - 1)) + 1;
  return text.slice(lineStart, position);
}

function tokenAtCursor(text: string, position: number): CursorToken | null {
  const before = text.slice(0, position);
  const match = before.match(WORD_PREFIX_PATTERN);
  if (!match || match.index === undefined) {
    return { fragment: '', start: position, end: position };
  }

  // A cursor in the middle of an existing token must not offer a completion
  // that would silently splice itself into the rest of the user's word.
  const following = text.slice(position);
  if (/^[\p{L}\p{N}]/u.test(following)) return null;

  return {
    fragment: match[0],
    start: match.index,
    end: position,
  };
}

function protectedInput(text: string, position: number, token: string): boolean {
  const line = lineBefore(text, position);
  const trimmed = line.trimStart();

  // Slash commands and bang commands have their own completion system.
  if (/^(?:\/|!)/u.test(trimmed)) return true;
  // Never put natural-language predictions inside paths or URLs.
  if (/^(?:https?|file):\/\//iu.test(trimmed)) return true;
  if (/^(?:\.{1,2}[\\/]|[A-Za-z]:[\\/])/u.test(trimmed)) return true;
  if (/(?:^|\s)(?:https?|file):\/\/\S*$/iu.test(line)) return true;
  if (/(?:^|\s)(?:\.{1,2}[\\/]|[A-Za-z]:[\\/])\S*$/u.test(line)) return true;

  if (!token) {
    // A trailing space after an identifier/secret is still protected: there is
    // no current token for the caller to pass us in that case.
    if (/(?:^|\s)[A-Z][A-Z0-9_]*\s*$/u.test(line) && /[_\d]/u.test(line)) return true;
    if (/(?:^|\s)(?:sk|pk|ghp|github_pat|xox[baprs]-)[A-Za-z0-9_-]*/iu.test(line)) return true;
    if (/\b(?:const|let|var|function|class|import|export|return|if|for|while)\b[\s\S]*[{}[\];=]/u.test(line)) return true;
    if (/[A-Za-z_$][\w$]*\s*=\s*$/u.test(line)) return true;
    return false;
  }

  // A path or a namespaced identifier is not prose, so nothing is offered
  // inside one. An underscore alone no longer disqualifies a token: the two
  // rules below already catch the shapes that matter (a secret, an
  // environment variable), and refusing every snake_case name meant the one
  // kind of identifier a coding session types constantly was never completed.
  if (/[\\\/.:]/u.test(token)) return true;
  if (/^(?:sk|pk|ghp|github_pat|xox[baprs]-)/iu.test(token)) return true;
  // Environment variables and machine identifiers are not prose.
  if (/^[A-Z][A-Z0-9_]*$/u.test(token) && /[_\d]/u.test(token)) return true;
  return false;
}

function sourcePriority(source: LocalSuggestionSource): number {
  switch (source) {
    case 'project': return 4;
    case 'history': return 3;
    case 'context': return 2;
    case 'dictionary': return 1;
  }
}

function addCandidate(
  model: LanguageModel,
  value: string,
  weight: number,
  source: LocalSuggestionSource,
): string | null {
  const word = normalizeWord(value);
  if (word.length < 2 || !/^[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*$/u.test(word)) return null;
  // History may contain an explicitly approved secret or a machine identifier.
  // Do not let either become a learned completion.
  if (/[\\\/.:]/u.test(word) || unlearnable(value) || unlearnable(word)) return null;
  const previous = model.candidates.get(word);
  if (previous) {
    previous.frequency += weight;
    if (sourcePriority(source) > sourcePriority(previous.source)) previous.source = source;
  } else {
    model.candidates.set(word, { frequency: weight, source });
  }
  return word;
}

function addTransition(
  table: Map<string, Map<string, number>>,
  key: string,
  value: string,
  weight: number,
): void {
  const values = table.get(key) ?? new Map<string, number>();
  values.set(value, (values.get(value) ?? 0) + weight);
  table.set(key, values);
}

function addSequence(
  model: LanguageModel,
  sequence: string,
  weight: number,
  source: LocalSuggestionSource,
): void {
  const tokens = rawWordsIn(sequence);
  const normalized: string[] = [];
  for (const token of tokens) {
    const word = addCandidate(model, token, weight, source);
    if (word) normalized.push(word);
  }

  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    if (previous && current) addTransition(model.bigrams, previous, current, weight);
  }
  for (let index = 2; index < normalized.length; index += 1) {
    const first = normalized[index - 2];
    const second = normalized[index - 1];
    const current = normalized[index];
    if (first && second && current) addTransition(model.trigrams, first + '\u0000' + second, current, weight);
  }
}

function buildModel(context: LocalSuggestionContext, english: boolean): LanguageModel {
  const model: LanguageModel = {
    candidates: new Map<string, CandidateStats>(),
    bigrams: new Map<string, Map<string, number>>(),
    trigrams: new Map<string, Map<string, number>>(),
  };

  // The built-in word list and phrase corpus are English, so they are the
  // only part gated on the language. Everything the model actually learns -
  // the user's own prompts, the project's vocabulary - is language-agnostic
  // and stays on in every language; switching to another one used to turn
  // prediction off entirely rather than merely dropping the English seed.
  if (english) {
    for (const word of ENGLISH_WORDS) addCandidate(model, word, 1, 'dictionary');
    for (const phrase of CONTEXT_CORPUS) addSequence(model, phrase, 1.5, 'context');
  }

  const history = context.history ?? [];
  for (let index = 0; index < history.length; index += 1) {
    const line = history[index]?.trim() ?? '';
    if (!line || /^(?:\/|!)/u.test(line)) continue;
    // Recent prompts matter a little more than old prompts, without allowing a
    // single typo to dominate the entire vocabulary.
    const recency = 4 + ((index + 1) / Math.max(1, history.length)) * 3;
    addSequence(model, line, recency, 'history');
  }

  for (const word of context.projectVocabulary ?? []) {
    addCandidate(model, word, 10, 'project');
  }
  for (const command of context.commands ?? []) {
    addCandidate(model, command.replace(/^[/!]/u, ''), 2, 'context');
  }
  return model;
}

/**
 * The built model, kept between keystrokes.
 *
 * Rebuilding it per call meant walking the whole dictionary, the phrase corpus
 * and every remembered prompt on every character typed - about a millisecond
 * per keystroke at 120 lines of history, growing with the history, and paid
 * inside the render pass. Nothing that goes into the model changes while a
 * word is being typed, so it is keyed on the shape of its inputs instead.
 *
 * A handful of entries covers the real switches (a submitted prompt, a changed
 * workspace, toggling the English seed) without holding old sessions alive.
 */
const MODEL_CACHE_LIMIT = 4;
const modelCache = new Map<string, LanguageModel>();

function modelKey(context: LocalSuggestionContext, english: boolean): string {
  const history = context.history ?? [];
  return [
    english ? 'en' : '-',
    history.length,
    history.at(-1) ?? '',
    (context.projectVocabulary ?? []).join(','),
    (context.commands ?? []).length,
  ].join('');
}

function modelFor(context: LocalSuggestionContext, english: boolean): LanguageModel {
  const key = modelKey(context, english);
  const cached = modelCache.get(key);
  if (cached) return cached;
  const model = buildModel(context, english);
  // Oldest first: Map preserves insertion order, so the first key is the least
  // recently built.
  if (modelCache.size >= MODEL_CACHE_LIMIT) {
    const oldest = modelCache.keys().next().value;
    if (oldest !== undefined) modelCache.delete(oldest);
  }
  modelCache.set(key, model);
  return model;
}

function settingsOf(input?: Partial<LocalAssistanceSettings>): LocalAssistanceSettings {
  return { ...DEFAULT_SETTINGS, ...(input ?? {}) };
}

function displayWord(word: string, fragment: string): string {
  if (fragment.length > 0 && fragment === fragment.toUpperCase()) return word.toUpperCase();
  if (fragment.length > 0 && fragment[0] === fragment[0]?.toUpperCase()) {
    return word.charAt(0).toUpperCase() + word.slice(1);
  }
  return word;
}

function scoreCandidate(
  model: LanguageModel,
  word: string,
  stats: CandidateStats,
  previous: readonly string[],
  fragmentLength: number,
): number {
  const previousOne = previous.at(-1);
  const previousTwo = previous.at(-2);
  const bigram = previousOne ? model.bigrams.get(previousOne)?.get(word) ?? 0 : 0;
  const trigram = previousTwo && previousOne
    ? model.trigrams.get(previousTwo + '\u0000' + previousOne)?.get(word) ?? 0
    : 0;
  const sourceBoost = stats.source === 'project'
    ? 22
    : stats.source === 'history'
      ? 12
      : stats.source === 'context'
        ? 5
        : 0;
  const prefixBoost = Math.min(24, fragmentLength * 3);
  const lengthPenalty = Math.max(0, word.length - fragmentLength) * 0.35;
  return 40 + Math.log1p(stats.frequency) * 8 + sourceBoost + prefixBoost + bigram * 18 + trigram * 32 - lengthPenalty;
}

function sortedSuggestions(candidates: readonly LocalSuggestion[]): readonly LocalSuggestion[] {
  return [...candidates]
    .sort((left, right) => right.score - left.score || left.value.localeCompare(right.value))
    .slice(0, MAX_SUGGESTIONS);
}

function nextWordPredictions(
  model: LanguageModel,
  previous: readonly string[],
  position: number,
): readonly LocalSuggestion[] {
  const previousOne = previous.at(-1);
  if (!previousOne) return [];
  const previousTwo = previous.at(-2);
  const values = new Map<string, number>();
  const tri = previousTwo && previousOne
    ? model.trigrams.get(previousTwo + '\u0000' + previousOne)
    : undefined;
  const bi = model.bigrams.get(previousOne);
  for (const [word, count] of tri ?? []) values.set(word, (values.get(word) ?? 0) + count * 2);
  for (const [word, count] of bi ?? []) values.set(word, (values.get(word) ?? 0) + count);

  return sortedSuggestions([...values].flatMap(([word, contextScore]) => {
    if (word === previousOne) return [];
    const stats = model.candidates.get(word);
    if (!stats) return [];
    return [{
      value: word,
      replacement: word + ' ',
      start: position,
      end: position,
      kind: 'prediction' as const,
      source: stats.source,
      score: 70 + contextScore * 20 + Math.log1p(stats.frequency) * 5,
    }];
  }));
}

export function suggestLocal(
  text: string,
  cursor: number,
  context: LocalSuggestionContext = {},
): readonly LocalSuggestion[] {
  const settings = settingsOf(context.settings);
  if (!settings.autocomplete) return [];
  const english = settings.language.toLowerCase() === 'en';

  const position = Math.max(0, Math.min(cursor, text.length));
  const token = tokenAtCursor(text, position);
  if (!token || protectedInput(text, position, token.fragment)) return [];

  const model = modelFor(context, english);
  if (!token.fragment) {
    if (!/\s$/u.test(text.slice(0, position))) return [];
    return nextWordPredictions(model, wordsIn(text.slice(0, position)), position);
  }

  const lower = token.fragment.toLowerCase();
  if (lower.length < 2) return [];
  const previous = wordsIn(text.slice(0, token.start));
  const candidates: LocalSuggestion[] = [];
  for (const [word, stats] of model.candidates) {
    if (!word.startsWith(lower) || word === lower) continue;
    const value = displayWord(word, token.fragment);
    candidates.push({
      value,
      replacement: value,
      start: token.start,
      end: token.end,
      kind: 'autocomplete',
      source: stats.source,
      score: scoreCandidate(model, word, stats, previous, lower.length),
    });
  }
  return sortedSuggestions(candidates);
}

/**
 * Return only the untyped suffix that can be painted as ghost text.
 * Suggestions are intentionally hidden when the cursor is not at the end:
 * this keeps editing in the middle of a draft completely unsurprising.
 */
export function inlineSuggestionSuffix(
  text: string,
  cursor: number,
  suggestion: LocalSuggestion | undefined,
): string {
  if (!suggestion || cursor !== text.length || suggestion.end > cursor || suggestion.start > suggestion.end) return '';
  if (suggestion.start === suggestion.end) return suggestion.replacement;
  const typed = text.slice(suggestion.start, suggestion.end);
  if (!suggestion.replacement.toLowerCase().startsWith(typed.toLowerCase())) return '';
  return suggestion.replacement.slice(typed.length);
}

export function applyLocalSuggestion(
  text: string,
  cursor: number,
  suggestion: LocalSuggestion,
): { readonly text: string; readonly cursor: number } {
  const start = Math.max(0, Math.min(suggestion.start, text.length));
  const end = Math.max(start, Math.min(suggestion.end, text.length));
  const next = text.slice(0, start) + suggestion.replacement + text.slice(end);
  return { text: next, cursor: start + suggestion.replacement.length };
}

export const DEFAULT_LOCAL_ASSISTANCE_SETTINGS = DEFAULT_SETTINGS;

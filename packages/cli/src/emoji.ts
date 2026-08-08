/**
 * Emoji, for the human.
 *
 * The agent is forbidden from writing these — its output goes into a terminal
 * it cannot inspect, and it is here to move code rather than to perform. None
 * of that applies to the developer typing into their own prompt: this is how
 * they say "that one hurt" in one character, and the input box is theirs.
 *
 * Shortcodes rather than a picker because a terminal has no palette to click.
 * `::sob::` is typed in the flow of a sentence, and `::so` is enough to bring
 * up the handful of candidates that start that way.
 *
 * The list is curated, not generated. The full Unicode set is about eighteen
 * hundred entries, most of which nobody has ever typed on purpose, and a menu
 * that answers `::s` with forty flags is worse than one that answers with six
 * things people actually send.
 */

export interface EmojiEntry {
  readonly name: string;
  readonly emoji: string;
  /** Alternative names that resolve to the same glyph. */
  readonly aliases?: readonly string[];
}

export const EMOJI: readonly EmojiEntry[] = [
  // Faces — the ones that carry a reaction.
  { name: 'sob', emoji: '😭', aliases: ['cry_hard'] },
  { name: 'joy', emoji: '😂', aliases: ['lol'] },
  { name: 'rofl', emoji: '🤣', aliases: ['kkk'] },
  { name: 'smile', emoji: '😄' },
  { name: 'grin', emoji: '😁' },
  { name: 'sweat_smile', emoji: '😅' },
  { name: 'wink', emoji: '😉' },
  { name: 'thinking', emoji: '🤔' },
  { name: 'neutral', emoji: '😐' },
  { name: 'expressionless', emoji: '😑' },
  { name: 'melting', emoji: '🫠' },
  { name: 'upside_down', emoji: '🙃' },
  { name: 'sunglasses', emoji: '😎' },
  { name: 'nerd', emoji: '🤓' },
  { name: 'sleepy', emoji: '😴' },
  { name: 'dizzy_face', emoji: '😵' },
  { name: 'exploding_head', emoji: '🤯' },
  { name: 'scream', emoji: '😱' },
  { name: 'fearful', emoji: '😨' },
  { name: 'cold_sweat', emoji: '😰' },
  { name: 'confused', emoji: '😕' },
  { name: 'frowning', emoji: '☹️' },
  { name: 'cry', emoji: '😢' },
  { name: 'angry', emoji: '😠' },
  { name: 'rage', emoji: '😡' },
  { name: 'triumph', emoji: '😤' },
  { name: 'pleading', emoji: '🥺' },
  { name: 'star_struck', emoji: '🤩' },
  { name: 'heart_eyes', emoji: '😍' },
  { name: 'yawning', emoji: '🥱' },
  { name: 'zany', emoji: '🤪' },
  { name: 'shush', emoji: '🤫' },
  { name: 'salute', emoji: '🫡' },
  { name: 'skull', emoji: '💀' },
  { name: 'ghost', emoji: '👻' },
  { name: 'alien', emoji: '👽' },
  { name: 'robot', emoji: '🤖' },
  { name: 'clown', emoji: '🤡' },
  { name: 'poop', emoji: '💩' },

  // Hands and people.
  { name: 'thumbsup', emoji: '👍', aliases: ['+1'] },
  { name: 'thumbsdown', emoji: '👎', aliases: ['-1'] },
  { name: 'ok_hand', emoji: '👌' },
  { name: 'clap', emoji: '👏' },
  { name: 'raised_hands', emoji: '🙌' },
  { name: 'pray', emoji: '🙏', aliases: ['thanks'] },
  { name: 'wave', emoji: '👋' },
  { name: 'point_right', emoji: '👉' },
  { name: 'point_left', emoji: '👈' },
  { name: 'point_up', emoji: '👆' },
  { name: 'point_down', emoji: '👇' },
  { name: 'muscle', emoji: '💪' },
  { name: 'fist', emoji: '✊' },
  { name: 'handshake', emoji: '🤝' },
  { name: 'facepalm', emoji: '🤦' },
  { name: 'shrug', emoji: '🤷' },
  { name: 'typing', emoji: '🧑‍💻', aliases: ['dev', 'coder'] },
  { name: 'detective', emoji: '🕵️' },
  { name: 'eyes', emoji: '👀' },
  { name: 'brain', emoji: '🧠' },

  // Verdicts. The ones that end up in a commit message or a review.
  { name: 'white_check_mark', emoji: '✅', aliases: ['check', 'done'] },
  { name: 'x', emoji: '❌', aliases: ['fail'] },
  { name: 'warning', emoji: '⚠️' },
  { name: 'no_entry', emoji: '⛔' },
  { name: 'question', emoji: '❓' },
  { name: 'exclamation', emoji: '❗' },
  { name: 'heavy_plus', emoji: '➕' },
  { name: 'heavy_minus', emoji: '➖' },
  { name: 'recycle', emoji: '♻️' },
  { name: 'sparkles', emoji: '✨' },
  { name: 'star', emoji: '⭐' },
  { name: 'zap', emoji: '⚡' },
  { name: 'boom', emoji: '💥' },
  { name: 'fire', emoji: '🔥' },
  { name: 'rocket', emoji: '🚀' },
  { name: 'tada', emoji: '🎉', aliases: ['party'] },
  { name: 'trophy', emoji: '🏆' },
  { name: 'hundred', emoji: '💯' },
  { name: 'heart', emoji: '❤️' },
  { name: 'broken_heart', emoji: '💔' },
  { name: 'purple_heart', emoji: '💜' },

  // The working day.
  { name: 'bug', emoji: '🐛' },
  { name: 'ant', emoji: '🐜' },
  { name: 'snake', emoji: '🐍', aliases: ['python'] },
  { name: 'whale', emoji: '🐳', aliases: ['docker'] },
  { name: 'penguin', emoji: '🐧', aliases: ['linux'] },
  { name: 'octopus', emoji: '🐙' },
  { name: 'cat', emoji: '🐱' },
  { name: 'dog', emoji: '🐶' },
  { name: 'wrench', emoji: '🔧' },
  { name: 'hammer', emoji: '🔨' },
  { name: 'gear', emoji: '⚙️' },
  { name: 'nut_and_bolt', emoji: '🔩' },
  { name: 'lock', emoji: '🔒' },
  { name: 'unlock', emoji: '🔓' },
  { name: 'key', emoji: '🔑' },
  { name: 'shield', emoji: '🛡️' },
  { name: 'mag', emoji: '🔍', aliases: ['search'] },
  { name: 'bulb', emoji: '💡', aliases: ['idea'] },
  { name: 'memo', emoji: '📝', aliases: ['note'] },
  { name: 'books', emoji: '📚', aliases: ['docs'] },
  { name: 'clipboard', emoji: '📋' },
  { name: 'package', emoji: '📦' },
  { name: 'file_folder', emoji: '📁' },
  { name: 'page', emoji: '📄' },
  { name: 'chart', emoji: '📊' },
  { name: 'chart_up', emoji: '📈' },
  { name: 'chart_down', emoji: '📉' },
  { name: 'calendar', emoji: '📅' },
  { name: 'pushpin', emoji: '📌' },
  { name: 'paperclip', emoji: '📎' },
  { name: 'link', emoji: '🔗' },
  { name: 'bell', emoji: '🔔' },
  { name: 'hourglass', emoji: '⌛' },
  { name: 'stopwatch', emoji: '⏱️' },
  { name: 'alarm', emoji: '⏰' },
  { name: 'computer', emoji: '💻' },
  { name: 'desktop', emoji: '🖥️' },
  { name: 'keyboard', emoji: '⌨️' },
  { name: 'phone', emoji: '📱' },
  { name: 'camera', emoji: '📷' },
  { name: 'satellite', emoji: '📡' },
  { name: 'battery', emoji: '🔋' },
  { name: 'plug', emoji: '🔌' },
  { name: 'floppy', emoji: '💾', aliases: ['save'] },
  { name: 'cd', emoji: '💿' },
  { name: 'printer', emoji: '🖨️' },
  { name: 'trash', emoji: '🗑️' },
  { name: 'construction', emoji: '🚧', aliases: ['wip'] },
  { name: 'traffic_light', emoji: '🚦' },
  { name: 'rotating_light', emoji: '🚨', aliases: ['alert'] },
  { name: 'coffee', emoji: '☕' },
  { name: 'beer', emoji: '🍺' },
  { name: 'pizza', emoji: '🍕' },
  { name: 'cake', emoji: '🍰' },
  { name: 'moon', emoji: '🌙' },
  { name: 'sun', emoji: '☀️' },
  { name: 'rainbow', emoji: '🌈' },
  { name: 'snowflake', emoji: '❄️' },
  { name: 'ocean', emoji: '🌊' },
  { name: 'earth', emoji: '🌍' },
  { name: 'seedling', emoji: '🌱' },
  { name: 'four_leaf_clover', emoji: '🍀' },
  { name: 'dart', emoji: '🎯' },
  { name: 'game_die', emoji: '🎲' },
  { name: 'joystick', emoji: '🕹️' },
  { name: 'art', emoji: '🎨' },
  { name: 'music', emoji: '🎵' },
  { name: 'movie', emoji: '🎬' },
  { name: 'balance', emoji: '⚖️' },
  { name: 'infinity', emoji: '♾️' },
];

/** name -> emoji, aliases folded in. Built once. */
const BY_NAME: ReadonlyMap<string, EmojiEntry> = (() => {
  const index = new Map<string, EmojiEntry>();
  for (const entry of EMOJI) {
    index.set(entry.name, entry);
    for (const alias of entry.aliases ?? []) index.set(alias, entry);
  }
  return index;
})();

export function findEmoji(name: string): EmojiEntry | undefined {
  return BY_NAME.get(name.toLowerCase());
}

/**
 * Candidates for a partly typed name.
 *
 * Three tiers, and the ordering inside each one is deliberate rather than
 * incidental: an exact name, then anything starting with the fragment, then
 * anything containing it. Someone typing `:fi` means `fire` far more often than
 * `file_folder`, and a substring match that outranked a prefix would bury it.
 *
 * Within a tier, shortest name wins and ties break alphabetically. That is not
 * a guess at popularity — it is the only rule available that is stable. Sorting
 * by nothing meant the answer came out in the order the list happens to be
 * written in, so `:fi` offered `fist` before `fire` purely because hands are
 * declared above verdicts in this file.
 */
export function matchEmoji(fragment: string, limit = 8): EmojiEntry[] {
  const needle = fragment.toLowerCase();
  if (!needle) return EMOJI.slice(0, limit);

  const tiers: { name: string; entry: EmojiEntry }[][] = [[], [], []];
  const seen = new Set<string>();

  for (const [name, entry] of BY_NAME) {
    const tier = name === needle ? 0 : name.startsWith(needle) ? 1 : name.includes(needle) ? 2 : -1;
    if (tier < 0) continue;
    // One row per glyph. Two names for the same picture is not two choices.
    const key = `${tier}:${entry.emoji}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (tiers[tier] as { name: string; entry: EmojiEntry }[]).push({ name, entry });
  }

  const byCloseness = (a: { name: string }, b: { name: string }): number =>
    a.name.length - b.name.length || a.name.localeCompare(b.name);

  const glyphs = new Set<string>();
  const out: EmojiEntry[] = [];
  for (const tier of tiers) {
    for (const { entry } of tier.sort(byCloseness)) {
      if (glyphs.has(entry.emoji)) continue;
      glyphs.add(entry.emoji);
      out.push(entry);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export interface OpenShortcode {
  /** Index of the opening `:`. */
  readonly start: number;
  /** What has been typed after it. */
  readonly fragment: string;
}

/**
 * Colons that open a shortcode, and colons that are just colons.
 *
 * `:name:` is the Discord spelling and the one people already have in their
 * fingers, but a single colon is also the most overloaded character a
 * developer types: `std::collections`, `http://`, `12:30`, `key: value`,
 * `C:\Users`, a ternary, a type annotation, a label.
 *
 * One rule separates them cleanly: **the opening colon must start a word.** It
 * has to sit at the beginning of the input or directly after whitespace.
 * That leaves every case above alone — each of their colons follows a letter,
 * a digit or another colon — while `I broke it :sob:` opens exactly as it
 * should.
 */
const OPENS_A_NAME = /(?:^|\s):([a-z0-9_+-]*)$/i;

/** The unclosed `:name` the cursor is sitting in, if there is one. */
export function openShortcode(text: string, cursor: number): OpenShortcode | null {
  const before = text.slice(0, cursor);
  const match = OPENS_A_NAME.exec(before);
  if (!match) return null;

  const fragment = match[1] ?? '';
  // A lone `:` opens nothing. Every menu that appears has to be dismissed, and
  // one that appears on a character this common would be in the way constantly.
  if (fragment.length === 0) return null;

  return { start: before.length - fragment.length - 1, fragment };
}

/**
 * Replace every closed `:name:` with its emoji.
 *
 * Applied on submit as well as on the keystroke that closes one, so a shortcode
 * pasted in as part of a longer line still resolves. Two things are left
 * exactly as typed: a name that is not in the list, because silently deleting
 * `:deploy:` would lose text the developer meant to send, and any colon that
 * does not start a word, because that is `std::vec`, not a shortcode.
 */
export function expandShortcodes(text: string): string {
  return text.replace(
    /(^|\s):([a-z0-9_+-]+):/gi,
    (whole, lead: string, name: string) => {
      const found = findEmoji(name);
      return found ? `${lead}${found.emoji}` : whole;
    },
  );
}

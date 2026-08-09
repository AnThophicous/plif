# Minimal Terminal and Themes Design

## Scope

Plif will use a quiet, keyboard-first terminal surface. Background tasks are live chrome rather than history: only running or attention-required tasks appear, `Ctrl+T` opens them, and completed tasks disappear. Tool calls use two stable headers, `• Ran <command>` and `• Edited <files> (+A -R)`, followed by a compact rail and a folded transcript hint.

## Interaction

- `Ctrl+T` toggles the task panel when tasks are visible; otherwise it toggles the newest tool transcript.
- `Ctrl+R` toggles the newest completed thinking block.
- Finished thinking is grey and opens beneath a `Thinking:` label.
- Tool batching remains capped at three. The system prompt asks the model to explain a coherent batch before calling it, without forcing narration before every harmless read.

## Shell intelligence

Command display uses a deterministic PowerShell/Bash tokenizer for syntax colour because LSP cannot colour an argv string embedded in a timeline event. The language-server layer separately supports PowerShell and shell files for diagnostics, definitions and references through PowerShell Editor Services and bash-language-server when installed.

## Theme API

Themes are JSON/JSONC documents with a `.theme` extension discovered in `~/.plif/`. A theme may override palette, shell syntax, diff syntax, borders, emphasis, glyphs and layout. Unknown or invalid fields are rejected with a readable diagnostic; missing fields inherit the built-in minimal theme. The selected theme is stored as `theme` in Plif config. `/theme` opens the existing picker over built-in and discovered themes.

## Visual rules

Grey hierarchy and bold weight carry ordinary structure. Accent appears only for current focus or active work. Semantic green/yellow/red appear only for success/warning/failure. Borders and metadata remain faint. Themes can override the values but not the semantic keys components consume.

## Verification

Tests cover task filtering, shortcut ownership, transcript folding, shell tokenization, theme discovery/validation/merge, `/theme`, and PowerShell/Bash LSP resolution. Full typecheck, tests, build, schema parse and CLI smoke test gate completion.

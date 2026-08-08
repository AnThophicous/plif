/**
 * Turn colour on before anything can decide it is off.
 *
 * This has to be its own module, and it has to be imported first. Chalk — under
 * Ink — works out its colour level once, at import time, from the environment
 * and from whether stdout is a TTY. ESM hoists every `import` above the module
 * body, so setting these variables inside `preview.mts` runs *after* chalk has
 * already made up its mind, and the preview comes out plain the moment it is
 * piped anywhere. Which is always: a piped preview is the only kind an agent or
 * a CI job can read.
 *
 * The symptom is quietly misleading rather than obviously broken — the frames
 * look right, so it reads as "this screen has no colour" instead of "the
 * harness lost it".
 */

process.env['COLORTERM'] = 'truecolor';
process.env['WT_SESSION'] = 'preview';
process.env['TERM'] = process.env['TERM'] ?? 'xterm-256color';
process.env['FORCE_COLOR'] = '3';

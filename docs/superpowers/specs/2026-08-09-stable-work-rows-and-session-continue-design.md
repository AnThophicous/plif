# Stable Work Rows and Session Continue Design

## Goal

Keep task and subagent updates from changing the live frame height during automatic follow, and make `plif continue [id]` the single session-resume command.

## Work rows

- Active tasks/subagents render as a stable one-row summary by default.
- Creation and start events never auto-expand details.
- `Ctrl+T` explicitly expands or collapses details; `Esc` collapses.
- Updates may change text and status but not the collapsed height.
- Timeline follow and `scrollOffset` remain owned only by timeline navigation.

## Session continuation

- `plif continue` resolves the latest session in the current workspace.
- `plif continue <id-or-prefix>` resolves that session in the current workspace.
- Missing and ambiguous IDs produce the existing actionable errors.
- `plif resume <id>` remains a compatibility alias.

## Verification

- Reducer tests prove work creation does not expand rows.
- Argument tests cover both forms of `continue` and the `resume` alias.
- Build and whitespace validation remain required.

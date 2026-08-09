# Tool Compaction and Rounded UI Design

## Goal

Keep project discovery readable without withholding information from the model.

## Behavior

- `read_file` content is returned to the model but never printed in the user timeline.
- Full successful output is visible only for `run_command`, `write_file`, `edit_file`, and `list_dir`.
- A failed hidden-output tool may show one short error line.
- Consecutive successful `Read` calls collapse to `Executed Read (Nx)`.
- Consecutive successful `List` calls collapse to `Executed List (Nx)`.
- `Ctrl+T` expands grouped targets; grouped lists also reveal their directory listings.
- While a turn is running, Read/List counts live in one mutable dock rather than timeline rows.
- At turn completion the dock becomes one final expandable `Executed Read Nx · List Nx` row.
- Parent `Subagent` tool rows never enter the main timeline; child activity lives only in the subagent dock.
- The subagent dock sits immediately above the prompt, collapsed to one horizontal line by default. `Ctrl+S` opens the selected child's transcript upward.
- Cumulative reasoning snapshots are normalized into true deltas before reaching model context or UI.
- Application panels use rounded borders consistently.
- The Monochrome theme is selected in the actual global config and inactive picker labels remain readable.

## Publication

This internal design document stays local and must not be committed or published.

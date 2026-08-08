# Operational Terminal Visual Design

## Goal

Bring Plif's active terminal experience close to the provided references: minimal dark operational chrome, compact activity lines, a travelling highlight across active status text, and meaningful terminal-window titles.

## Visual Direction

The interface remains dark and text-first. It favors a single bright active signal over large bordered panels, keeps secondary data quiet, and uses blue-violet for live work, muted gray for metadata, green only for success, and red only for failure.

## Header and Context

- Never render generated container names in the header or prompt badge.
- Replace the existing verbose context display with a single `Context` label and a compact filled/empty progress bar styled like the reference; it exposes context pressure without a separate panel or large numeric fraction.
- Preserve narrow-terminal fallbacks: when width is insufficient, retain the compact context bar and remove optional model/isolation detail first.

## Active Work and Animation

- The live activity line continues to use the current action label (`Parsing`, `Tracing`, command state, and similar) with elapsed time and token count.
- Each animation tick applies a narrow bright band to consecutive grapheme clusters of the active label. The band advances left-to-right and wraps around, producing a travelling highlight without changing text, width, or layout.
- The spinner remains a stable-width braille animation. It and the highlight run only while Plif is active; they stop when work settles.

## Terminal Title

- At the start of active work, update the terminal title at spinner cadence using `Plif — Working <spinner-frame>`.
- On every terminal completion path (successful answer, error, cancellation, command completion, or rejected action), set the title to `Plif — Completed ✓`.
- A later task restarts the working animation. The application does not emit a title update after unmounting.

## Tasks and Subagents

- Replace task cards and summary cards with compact line-oriented activity views.
- A running row uses the spinner, blue-violet operation label, muted summary, and optional duration. Settled rows use success/failure symbols and corresponding semantic tones.
- The default collapsed subagent view lists active subagents as short rows rather than a generic count. The expanded view keeps selection and detail but removes its large rounded card and uses the same activity-row language.
- Background tasks follow the same compact rows in both the inline indicator and expanded task list.

## Scope and Safety

- This is a presentation and terminal-title change. It does not alter task scheduling, subagent lifecycle, container isolation, model requests, transcripts, or context compaction behavior.
- The concurrent pasted-content, multiline-prompt, and 1M-context work remains a separate functional change but will be executed in the same session after both plans are complete.

## Tests

- Unit-test the grapheme-aware travelling-highlight segment across ticks, including wraparound and ASCII fallback.
- Unit-test terminal-title string formatting for working frames and completed state; write through an injectable title sink rather than a real terminal in tests.
- Unit-test task and subagent compact-row projections for running, successful, failed, and approval-waiting statuses.
- Run the complete CLI render and typecheck suite after combining this work with the existing pasted-content plan.

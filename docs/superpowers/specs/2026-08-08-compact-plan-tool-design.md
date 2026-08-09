# Compact Plan Tool Design

## Goal

Give Plif a planning tool that reads like the rest of the minimal terminal UI and prevents oversized ceremonial plans.

## Behavior

- `update_plan` accepts between one and six short checkpoints.
- A plan may contain at most one `in_progress` checkpoint.
- The model is instructed to plan only multi-step work, update at meaningful checkpoints, and avoid narrating obvious actions.
- The timeline renders `Plan updated` once, followed by compact `completed`, `in_progress`, and `pending` rows.
- Long plan text uses the existing `Ctrl+T` transcript expansion behavior.
- Explanations remain available to the model but are not duplicated into the visible plan block.

## Validation

Unit tests cover valid plans, the six-item ceiling, multiple active checkpoints, tool description, and timeline rendering data.

## Publication

This internal design document stays local and must not be committed or published.

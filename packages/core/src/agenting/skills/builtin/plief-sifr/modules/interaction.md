# Interaction — interaction graph, forms, temporal UX

Interaction is first-class IR data, not decoration notes.

## InteractionGraph conventions (IR section / schema state-graph.schema.json)

For each semantic component/flow:
```text
STATE → EVENT → GUARD → TRANSITION → SIDE EFFECT → SETTLEMENT → RENDER CONSEQUENCE
states: only semantically relevant set (idle hover focus-visible pressed selected
disabled loading stale-refresh empty partial validation-error system-error success
optimistic-pending retry offline permission-denied destructive-confirmation overflow)
```
Guards prevent impossible combinations (no boolean soup); ordering-sensitive flows model transitions rather than ad-hoc loading flags. Async identity, cancellation and stale-response resurrection are modeled when race matters.

Microinteractions clarify cause/consequence for activation/toggle/copy/save/validation/selection/drag-drop/progress. Not every element animates (motion discipline in motion module).

## Forms are recovery systems

Visible/persistent labels where appropriate, field grouping, input purpose/type/autocomplete, instructions before errors, validation timing that doesn't punish typing, error association, recovery WITHOUT losing unrelated state, disabled/loading semantics, keyboard flow, submit/retry, destructive confirmation when relevant. Placeholder-only labels rejected.

## Temporal/data UX

Model when relevant: first load, background refresh, stale, sorting/filtering, pagination/infinite load, optimistic mutation, partial failure, retry, cancellation, empty results, permission limits, latency, racing requests. Skeleton/spinner/optimism are choices matched to clearest mental model. NEVER fabricate successful server behavior in production code to make UI look complete; prototypes mark simulated boundaries explicitly (`verification_state.gap_ledger`).

Data visualization chooses chart type from the question (comparison→bars/position, trend→line/area justified, composition→stacked, distribution→histogram/box/violin, relationship→scatter, single metric→number/context). No pie reflex; no gradients/3D slowing interpretation; explicit labels/units/zero-baselines/uncertainty/missing-data. A chart succeeds on interpretation speed, not impressiveness.

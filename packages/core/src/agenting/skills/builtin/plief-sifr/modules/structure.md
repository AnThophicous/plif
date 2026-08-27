# Structure — information architecture before style

Resolves unsettled IA: navigation model, page hierarchy, task sequence, progressive disclosure, density, list/detail relationships, mobile structural transformation, workspace shells.

## 1. Task graph first

`entry → orient → inspect/decide → act → system response → next state`. For each step record in IR `information_architecture`: question answered, info required, action advancing the task, context that must stay visible, deferrable items, failure modes + recovery.

## 2. Information obligations (IR `info_obligations`)

`must_see_before_action` · `must_remain_visible` · `reveal_on_demand` · plus background/status and historical/reference classes. Prevents "everything on the page" equal-weight UI. Use real labels and realistic content lengths; placeholder MEANING is never fine even when placeholder style is.

## 3. Structural invariants

Write only constraints whose violation would REJECT an option (e.g. primary action remains available after filtering; selected-object context survives detail navigation; destructive action cannot be confused with navigation).

## 4. Options — only when comparison changes a decision

2–4 structurally distinct options (vary thesis, not cosmetics). Each carries stable ID + mechanism-based name (never "Modern"/"Clean"), best-fit context, primary-action placement, disclosure strategy, mobile transformation, major advantage/cost, what evidence would falsify it. Two options preserving identical decision sequences are one option.

Pressure tests per serious option: task · information · volume (3/30/300/3000) · long-content/localization · narrow · intermediate (awkward widths) · wide · interruption/recovery · expertise duality · accessibility reading/focus order · states (empty/loading/partial/stale/permission-limited).

## 5. Convergence

Select/recommend ONE structure with dominant reason; name strongest alternative + the condition where it wins; "all valid" endings are failures. Freeze into IR `information_architecture` (nav model, ownership, sequence, persistent context, disclosure rules, structural responsive transforms, critical transitions). Without NEW evidence it is not reopened.

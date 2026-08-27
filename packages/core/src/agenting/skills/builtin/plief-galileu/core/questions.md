# Question Intelligence — env-before-ask ladder

Never ask the user something the environment can answer.

## Ladder per material UNKNOWN

```text
1 search established environment/capability state (.plif artifacts)
2 search repository (Cartographer map + targeted grep/ranges)
3 search provided files/attachments
4 search existing evidence ledger + assumption ledgers
5 THEN ask the user
```

## Ranking for questions that survive

Score ordinally (NO numeric scores): decision impact · uncertainty · irreversibility · dependency centrality · expected information gain; minimize user cost. Send max **3** consolidated questions per round; include the reason each matters and the branch each answer changes.

## Anti-patterns (fail conditions)

- Barrage interviews (>3/round).
- Asking about things present in supplied material (GAL-01 critical case).
- Translating uncertainty into fake precision ("73% confident").
- Open-ended "any preferences?" when the preference question maps to specific branches.

---
name: investigate
description: Find the cause of a bug or failure before changing anything
---

Work from evidence, not from a guess about what is probably wrong.

1. Reproduce it first. Run the failing test or command and read the actual
   error, in full. If you cannot reproduce it, say so and stop — a fix for a
   failure you never saw is a guess.
2. Read the code the error points at before reading anything else. Follow the
   stack, not your intuition about where the bug "feels like" it lives.
3. Form one hypothesis and state it. Then find the cheapest way to prove it
   wrong. A hypothesis you cannot falsify is not one.
4. Only once you can explain the failure end to end, change something.
5. Re-run the same reproduction. If it now passes, say what the cause was, not
   just what you changed.

Do not fix symptoms you cannot connect to the cause. Two unexplained fixes that
happen to make a test pass will fail differently next week.

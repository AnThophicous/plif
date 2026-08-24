---
name: write-tests
description: Add tests that would catch a real regression
---

A test earns its place by failing when something is actually broken.

Before writing one, run the existing suite and read a few tests, so the new ones
match how this project already tests things.

Write tests for:
- the behaviour the code promises, at its boundaries
- the bug you just fixed, in a form that fails on the old code
- the invariant that would be expensive to get wrong

Do not write tests that assert the implementation back at itself, that mock the
thing under test, or that pass no matter what the code does.

Verify the test fails before the fix and passes after. A test never seen red is
not evidence of anything.

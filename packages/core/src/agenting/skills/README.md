# Plif skill authoring

This directory documents the on-disk skill contract used by Plif. A skill is a reusable
procedure that the agent loads for a matching request; it is not a second system prompt.

## Where skills live

- User skills apply in every workspace: `~/.plif/skills/<name>/SKILL.md`.
- Project skills travel with a repository: `<workspace>/.plif/skills/<name>/SKILL.md`.
- A project skill with the same name overrides a user skill.

The agent should use `create_skill` rather than writing a file ad hoc. That validates the
name, writes the required format, and makes the skill available in the current session.

## Required format

```md
---
name: focused-kebab-case-name
description: One line describing precisely when this skill should be loaded
---

# Skill title

State the failure this procedure prevents, then give the exact order of operations.
End with the verification required before the agent reports success.
```

The `description` is routing metadata: the model sees it before it loads the body. Name
the trigger and the work, not a vague quality such as “expert” or “better”.

## Authoring rules

- Keep one skill focused on one repeatable workflow.
- Specify inputs, decisions, tool boundaries, failure handling, and verification.
- Do not duplicate the Plif kernel, grant permissions, invent tools, or embed credentials.
- Prefer project scope when the procedure depends on this repository.
- Reload and inspect the written skill before calling the work complete.


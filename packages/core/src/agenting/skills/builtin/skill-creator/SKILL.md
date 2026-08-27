---
name: skill-creator
description: Turn a way of working into a skill plif can load next time, and write it to disk
---

A skill is a procedure the agent loads instead of improvising. Write one when a
way of working would otherwise be re-explained every session; do not write one
for a task that happens once, for a fact that belongs in project instructions,
or for behaviour the default prompt already governs.

Use the create_skill tool to write it. It stores the file and makes the skill
loadable immediately, so you can test it in the same session.

## Choose the scope first

**project** writes to .plif/skills in the current workspace. Choose it when the
procedure depends on this repository: its build, its conventions, its review
rules, its deploy steps. It travels with the code and takes precedence over a
user skill of the same name.

**user** writes to the plif root and applies in every workspace. Choose it for
a way of working that is about the person, not the project.

When both would work, choose project. A skill that lives next to the code it
describes stays true longer than one that does not.

## PLI'EF vNext conventions (mandatory)

- Flagship naming is `Pli'ef <Codename>` display / `plief-<codename>` slug;
  the three historical brand tokens (quoted here solely as the retired-name
  list: "dme", "spynx", "plif-") are retired as primary names. (retired-name quote)
- New skills ship a `manifest.json` declaring `name/slug/version/description`,
  `artifacts.produced[]` / `artifacts.consumed[]`, and `schemas[]` when they
  exist. Conformance (`_kernel/scripts/package_conformance.py`) checks this.
- Cross-skill concepts (evidence states, capability protocol, R0–R3 risk,
  artifact paths) are NEVER restated locally — reference `_kernel/`.
- Every relative path mentioned must resolve (no silent fallback), and eval
  cases live under `evals/cases/*.json` with id/prompt/must/must_not/critical.


## The description is the whole routing decision

The body is invisible until something loads it. The description is the only
text in the model's context, so it must answer one question: in what situation
should this be loaded?

- Name the trigger, not the topic. "Review a diff for correctness, not style"
  routes; "code review helper" does not.
- Write the situation, not the quality. "Find the cause of a bug before changing
  anything" beats "expert debugging assistance".
- Use the words that appear in a real request, so a matching prompt is
  recognisable.
- One line, no newline, no restating the skill name.

If you cannot write the description in one line, the skill is doing more than
one thing. Split it.

## Write the body as decisions

The reader is an agent that already knows how to program and already has the
default instructions. The skill earns its place by removing a choice, not by
adding encouragement.

- Open with the failure this prevents. One or two sentences, concrete.
- Give an order of operations when order matters, and say why a step comes
  where it does.
- Prefer a rule with a threshold over an adjective. "Stop at three failed
  attempts and reassess" is a rule; "be persistent" is not.
- Say what to do when the evidence is missing, not only when it is present.
- Name the tools and files the procedure actually uses, and nothing you have not
  confirmed exists.
- End with a check the agent can run against its own output.

Do not restate the default prompt, do not add generic advice ("be thorough",
"consider edge cases"), do not pad with headings that carry one sentence, and
never use emoji. Apply the anti-ai-slop skill to the prose.

Length follows the procedure. A skill that fits on one screen and is followed
beats a long one that is skimmed.

## Test it before you call it done

1. Load it back with the skill tool and read what came out. A body that reads
   as advice rather than instruction needs another pass.
2. Name three requests that should load it, and one that plausibly could but
   should not. If the description does not separate them, rewrite it.
3. Follow the skill on a real task and note where you had to decide something
   the skill left open. Add that decision.

## Updating and removing

Writing the same name and scope again replaces the file, so an update is one
call. Tell the user what changed. To remove a skill, delete its directory under
.plif/skills or the plif root; the registry rebuilds from disk at startup.

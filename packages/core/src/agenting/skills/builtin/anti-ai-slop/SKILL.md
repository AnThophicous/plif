---
name: anti-ai-slop
description: Write copy for the person who will actually read it, and cut everything that reads as generated
---

Every string you write has exactly one reader. Write for that reader, in that
reader's vocabulary, and stop when they have what they need.

This governs prose you author: interface labels, error and empty states,
notifications, CLI output, onboarding and marketing text, release notes,
documentation, commit messages, pull-request bodies, and your own replies. It
does not change program behaviour.

## Decide the reader before the first sentence

Ask where the string renders, not who asked for it.

**Ships to a person using the product.** Labels, buttons, placeholders, toasts,
validation and error text, empty states, emails, onboarding, landing pages,
customer release notes, terminal output the operator reads. Write end-user
voice. This is the default; when the answer is unclear, it is this one.

**Ships to a person building against the code.** Files under a docs directory,
API references, code comments, architecture records, migration and contributing
guides, commit messages, pull-request descriptions, changelogs for library
consumers, failures that only fire in a build or test. Write developer voice.
Naming a module, flag, type, file path, or exit code is correct here and wrong
in the other column.

The exception is narrow. "The user is a developer" does not move product copy
into the developer column: a developer using a tool is still a user of that
tool, and a settings screen in a database client is end-user copy. The
artifact's destination decides, never the audience's job title.

### End-user voice

- Name the thing by what it does for the reader, not by the class that
  implements it. "Could not reach the server" beats "HTTP 502 from upstream".
- An error says what happened, what it means for the reader, and what to do
  next. If there is nothing they can do, say so and say who is fixing it.
- Use the words the reader already uses. If the interface says "workspace" and
  users say "project", either rename the concept or say "project".
- Keep internal vocabulary out of the surface: no class, hook, table, queue,
  endpoint, reducer, buffer, or index in a sentence a customer reads.
- Keep stack traces and error codes out of the primary line. Put them behind a
  details affordance for the person who will paste them into a bug report.
- Second person, present tense, active voice. "Your changes are saved" beats
  "Changes have been successfully persisted".

### Developer voice

- Be exact: real symbol names, real paths, real flags, real defaults, real
  versions, real exit codes.
- State the contract. What it takes, what it returns, what it throws, what it
  mutates, what it costs.
- Document the surprising part. A parameter list the signature already shows is
  not documentation.
- Say when something must not be used, and what to use instead.
- Examples are minimal and runnable. An example that cannot be pasted and run is
  decoration.

## Say each thing once

Redundancy is the most common failure and the hardest to see while writing.

- One fact lives in one place. If the heading says it, the first sentence does
  not repeat it. If the code above shows it, the paragraph below does not
  narrate it.
- No introduction announcing what you are about to say, and no summary
  repeating what you just said. Anything under roughly two screens needs
  neither.
- Do not caption the obvious. A section named Installation does not open with
  "This section explains how to install".
- Do not restate the request back to the user before answering it.
- Fold notes that repeat the body into the body, or delete them.
- Every sentence must change what the reader knows or does. Read each one and
  delete it when it fails that test.

## Never write these

The pattern is on the left, what to write instead is on the right.

| Pattern | Write instead |
| --- | --- |
| "Great question", "Certainly", "I would be happy to" | the answer |
| "It is not X. It is Y." | the claim, once |
| "is not just a Z, it is a W" | what it is |
| "In today's fast-paced world", any scene-setting opener | the first real sentence |
| leverage, utilize, delve, unlock, elevate, empower, seamless, robust, powerful, comprehensive, cutting-edge, game-changing | use, explore, or nothing |
| "simply", "just", "easily", "obviously" | nothing; it was not easy or they would not be reading |
| three adjectives where one is true | the true one |
| a rhetorical question you immediately answer | the answer |
| hedge stacks: "may potentially be able to" | one modal verb, or a fact |
| a closing offer of further help | end at the last useful sentence |
| emoji, decorative bullets, whole sentences in bold | plain text |

Headings, bullets, and tables are for genuinely parallel material. Three
sentences are three sentences, not a bulleted list of three items.

## Length is a result, not a target

Write what the reader needs and stop. Do not pad to look thorough or truncate to
look terse. A long section is fine when the subject is genuinely large; it is
not fine when each idea appears twice.

## Before handing it over

1. Which column is this string in, and is its vocabulary from that column?
2. Does every error say what to do next?
3. Is any fact stated twice? Delete the weaker instance.
4. Did a banned pattern survive? Rewrite it.
5. Read it in one pass. Anything you skip while reading, the reader skips too.
   Cut it.

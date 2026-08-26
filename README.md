<div align="center">

**Plif 0.3.9 — the stable, adaptive coding agent for your terminal.**

Bring your own model. Configure the provider yourself. Plif 0.3.9 is built for
long coding sessions with durable memory, better adaptation to the user, a
calmer terminal UI, stronger built-in skills, and a more reliable agent loop.

[![npm](https://img.shields.io/npm/v/%40plif%2Fcli?color=0b7285&label=npm)](https://www.npmjs.com/package/@plif/cli)
[![license](https://img.shields.io/badge/license-Apache--2.0-0b7285)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20.11-0b7285)](https://nodejs.org)
[![platform](https://img.shields.io/badge/platform-Windows-0b7285)](#what-the-sandbox-actually-enforces)
[![ci](https://github.com/AnThophicous/plif/actions/workflows/ci.yml/badge.svg)](https://github.com/AnThophicous/plif/actions/workflows/ci.yml)

</div>

---

## What's new in 0.3.9

### Isolated session scratch space

Every interactive and one-shot agent session now receives a disposable
container path at `/temp`, mounted separately from the project at `/project`.
Use `/temp` for logs, screenshots, probes, generated intermediates and other
scratch work; keep `/project` for files that are part of the user's requested
deliverable. The host scratch directory is created under the operating system's
temporary root, is never written to the project tree, and is removed when the
session exits. Run `/temp` to see the policy and path inside PLIF.

The mount is also added to default `/new` containers. A custom `/temp` mount is
respected when one is explicitly supplied, so advanced workflows keep control
without creating duplicate mount targets.

### `/status`

`/status` opens a focused, read-only view of the current PLIF session: runtime,
provider, model, effort, context, configuration source and integrations. It
redacts credentials instead of printing them.

### `/config`

`/config` opens a keyboard-first settings browser with search, categories,
inline editors and persistent TOML-backed settings. Provider, model, effort,
MCP and skills actions reuse the existing PLIF flows instead of creating a
second configuration system.

### Provider-aware model selection

`/model` now shows only models that are usable with the providers currently
available to the session. The picker keeps the active model visible, shows
provider, access, context and capability details while you browse, and uses a
bounded list/details layout that remains readable in wide and narrow terminals.
Use `/providers` to configure another provider; its models then appear in
`/model`. Provider names are added to rows only when two providers would
otherwise display the same model name.

### Models follow your providers

When a provider exposes model discovery, PLIF uses the authenticated provider
response as the available model set. Results are cached without credentials,
served stale while a low-frequency refresh runs, and updated when the provider
adds or removes models. Providers without a discovery endpoint keep their
curated fallback list and are labelled internally as fallback data.

Use `/providers` to add a provider; its catalog is warmed immediately in the
background and becomes available through `/model` without restarting PLIF.

### Free-first onboarding

A clean install can start through OpenCode's explicitly marked free route,
including `deepseek-v4-flash-free`, without asking for an unrelated provider
key. Paid providers remain locked until you configure them, and the picker
keeps those access boundaries visible instead of mixing unusable models into
the default list.

### Quieter startup

The home screen now keeps the PLIF wordmark above a compact outlined panel with
the mascot on the left and readiness on the right. Runtime details moved to
`/status`, so startup is calmer without losing the PLIF identity. The neutral
gray interface keeps its hierarchy while interaction and active states use
PLIF's pink accent identity.

### Under the hood

- `/status`, `/config`, `/models`, `/providers` and `/effort` read and update
  the same runtime/configuration state.
- Configuration writes continue through PLIF's existing atomic TOML persistence
  layer, with credentials kept redacted and outside the transcript.
- Screen-owned keyboard handling, terminal resize coverage and narrow/wide TUI
  previews received additional regression coverage.

### Durable provider continuation

The canonical session history remains append-only JSONL. PLIF stores only a
scoped, non-secret provider pointer beside it: `auto` uses native Codex thread
resume when it is available and replays the canonical transcript when the
pointer is missing, expired or incompatible. `replay` disables native
continuation; `native` prefers it but still fails safely to replay. Configure
the policy with `conversationState = "auto"` or
`PLIF_CONVERSATION_STATE=native|replay`. See
[the conversation-state guide](docs/conversation-state.md).

## Why 0.3.9

- **Adaptive memory.** Useful facts are ranked and reused without turning the
  conversation into noise.
- **Built-in skills.** Galileo, deep engineering audits, Office/rendering
  skills, MCP discovery, and focused planning workflows are ready to use.
- **Your model, your choice.** `/model` starts with usable routes only,
  including the explicit free OpenCode path on a clean install. Configure
  another provider through `/providers` to unlock its models; no unrelated
  provider key is requested in the process.
- **Long-session reliability.** Navigable transcript history, `/goal`, `/plan`,
  `/export`, compaction and recovery keep large sessions usable.
- **Safer execution.** Container-native workspaces, policy checks and an audit
  trail show what the agent actually did.

## Install

The current stable release is [v0.3.9](https://github.com/AnThophicous/plif/releases/tag/v0.3.9).
For a reproducible install, pin that version explicitly:

```powershell
npm install -g @plif/cli@0.3.9
```

To follow the newest published stable release instead:

```powershell
npm install -g @plif/cli@latest
```

```powershell
irm https://raw.githubusercontent.com/AnThophicous/plif/main/install.ps1 | iex
```

That script checks your Node version and runs `npm install -g @plif/cli`. If you
would rather skip the ceremony, the two are the same thing:

```powershell
npm install -g @plif/cli
plif
```

After an upgrade, `plif version` reports the installed CLI version. The full
release history is in [`CHANGELOG.md`](CHANGELOG.md).

The package is scoped; the command is not. npm refuses the bare name `plif` as
too close to `plist` and `plop`, so the package is `@plif/cli` and the binary it
installs is `plif`.

You need Node 20.11 or newer. You do not need Docker, WSL, administrator, or an
API key to start.

To remove it: `npm uninstall -g @plif/cli`. Your sessions and credentials live
in `~/.plif` and are left alone unless you delete them.

---

## What this is

plif is a terminal agent that reads your code, edits it, runs commands, and
tells you what it did. That description fits a dozen tools. Three things
underneath it do not.

**The agent works in a container, and plif builds the containers itself.** Not
Docker — there is no daemon and nothing to install. A container here is a
materialised `rootfs` assembled from content-addressed layers, with a `commit`
that diffs it. Layers deduplicate across containers, so two environments sharing
a 40 MB toolchain cost 40 MB, which is what makes snapshotting a workspace every
turn affordable rather than theoretical.

**The isolation is reported, never claimed.** `plif sandbox` prints what your
machine actually enforces and exits non-zero when it can enforce nothing.
Whatever the OS does not enforce is printed in warning colour in the opening
banner of every session, not hidden behind a verbose flag. The table further
down this page lists the gaps, including one that is genuinely awkward for us.

**The model is yours.** plif speaks the OpenAI-compatible wire format, plus
Anthropic's own, so any endpoint that speaks either works: a hosted frontier
model, a free tier, or Ollama on your own machine with no key at all. A clean
install starts on PLIF's built-in OpenCode free route; you can change it from
`/model` or configure another provider from `/providers`. `/model` shows only
models from providers that are already available in this session instead of
making you filter the entire catalog. Nothing phones home except one cached
version check you can switch off.

## Why not Claude Code or Codex

Those are good tools, they are faster than plif at a lot of things, and their
models are excellent. Use them if what you want is the shortest path from
question to answer.

Pick plif when the questions you have are about the agent rather than about the
answer:

- **Which model?** Codex runs OpenAI's models; Claude Code runs Anthropic's.
  plif runs whatever answers on an OpenAI-compatible URL. Switching provider is
  a menu, not a migration, and the conversation resets rather than silently
  attributing one model's turns to another.
- **What is it actually allowed to do?** plif answers with a table of what the
  kernel enforces on your machine, and with a hash-chained audit log of every
  decision. Not a policy document — the enforcement points are four objects the
  code cannot get past, listed below.
- **Can you read it?** The core is Apache-2.0 and it is this repository. The
  interesting parts are documented in the source, including the mistakes.

An honest disclaimer for this section: Codex CLI is also open source. The
difference is not openness, it is that plif's core is built around isolation and
provenance as the primary features rather than as configuration.

---

## The first five minutes

```
plif                      start a session in this folder
```

Press `/` for commands. Nothing is configured yet and that is intentional:

```
/model                    pick a provider and model, free ones included
/status                   inspect the current session and runtime
/config                   browse and edit PLIF settings
/new                      create a container for the agent to work in
/sandbox                  what your machine enforces, and what it does not
/mcp                      browse MCP servers, skills and the plugin marketplace
```

Type to talk to the agent. Type `!command` to run something yourself, and
`!!command` to run it privately, without the agent seeing the output.

Everything is recorded. `plif continue` reopens the last conversation for this
folder with the transcript back in the model's context.

## Commands

| Command | What it does |
|---|---|
| `plif` | Interactive session in the current folder |
| `plif prompt "<text>"` | One turn, prints the answer, exits |
| `plif continue` | Reopens the most recent session for this folder |
| `plif resume <id>` | Reopens a specific session |
| `plif sessions [--all]` | Lists recorded conversations |
| `plif sandbox` | Reports what the sandbox actually enforces |
| `plif mcp` | Lists configured MCP servers |
| `plif help [topic]` | |
| `plif version` | |

Flags: `--root <dir>` (default `~/.plif`), `--workspace <dir>` / `-C <dir>`,
`--strict`, `--json`.

`sessions` and `sandbox` never mount the interface. They print and exit, so they
compose with pipes and with CI. `plif sandbox` exits non-zero when the machine
cannot isolate anything, which is a thing a CI job can gate on.

---

## How it works

### Language and runtime

TypeScript throughout, on Node 20.11+, ESM only, strict compiler settings and no
transpiler in production — the shipped artifact is `tsc` output. The interface
is [Ink](https://github.com/vadimdemedes/ink), which is React reconciled onto a
terminal instead of a DOM. The Windows isolation layer reaches the Win32 API
through [koffi](https://koffi.dev), an FFI binding, so there is no native addon
to compile at install time and no prebuild matrix to maintain.

Tests are `node:test`, with no additional test framework. The release suite
covers the core runtime, sandbox boundary and CLI/TUI together.

### Three packages, one direction

```
packages/
  sandbox/   the OS isolation boundary — the only way a process is created
  core/      container runtime, path jail, policy, audit, the agent loop
  cli/       the terminal interface
```

The dependency runs strictly one way: `cli → core → sandbox`. The core never
renders and never asks a question; it emits events. That is what lets the same
engine run under an interface, under CI, and under a test.

### Four layers every access crosses

No public method on `Container` touches disk or creates a process without
passing all four. This is the invariant to preserve when editing:

| Layer | The question it answers | Where |
|---|---|---|
| `PathJail` | *Where* does this actually land? | `core/src/fs/vpath.ts` |
| `PolicyEngine` | Is this allowed to happen? | `core/src/policy/policy.ts` |
| `SandboxJail` | How confined is it while it runs? | `sandbox/src/backend.ts` |
| `AuditLog` | Record that it happened | `core/src/audit/log.ts` |

### The container model

- **Layer** — an immutable directory of changes, addressed by the sha256 of its
  own manifest, shared between containers.
- **Image** — an ordered stack of layers plus config: workdir, env, capabilities,
  limits. The digest is real identity; the same digest behaves the same way.
- **Container** — an instance of an image with a materialised `rootfs` that is
  *both* where processes run and the writable layer `commit` diffs. There is no
  second "upper" directory, because having two write destinations was a real bug
  that cost an empty commit.
- **Mount** — the only door host state comes through. Auditing the mount table
  answers "what can this agent reach?".

Capabilities and limits only ever narrow. A container can give up a capability
its image granted; it can never add one the image withheld. Limits take the
lower value. That is what makes an image a trust boundary rather than a
suggestion.

---

## What the sandbox actually enforces

On Windows today:

| Enforced by the kernel | Not enforced |
|---|---|
| Process-tree kill | Filesystem write blocking |
| Memory ceiling | Network blocking |
| Process-count ceiling | |
| CPU throttling | |

`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` is the flag doing the heavy lifting: if
plif dies to a SIGKILL, the OS still reaps the agent's entire process tree.

### The gap you need to know about

Running the agent for real, it had `write_file` denied by capability and
**worked around it** with `run_command ["node","-e","fs.writeFileSync(...)"]`.
It worked.

That is not a bug in the loop. It is the `filesystemWriteBlock: false` row in
the table above, demonstrated. Because writes are not blocked at the OS level, a
spawned process writes wherever you can write. So **granting `exec` while
denying `hostWrite` does not stop the agent editing host files; it only makes it
take a detour.** That sentence is now in the degradation report, because it was
possible to read "fs write block: not enforced" without making the connection.

The real fix is a restricted token, and it is not done.

AppContainer was evaluated and rejected: stronger isolation, but deny-by-default
on the filesystem, and a coding agent legitimately needs to read the repository,
the toolchain, the git config and the dependency caches. Rebuilding all of those
grants reproduces the host ACL with extra steps. OpenAI reached the same
conclusion for Codex's Windows sandbox.

### Policy, and why the most restrictive rule wins

Not first match, not last match — most restrictive. Policy files get edited by
people under pressure, and under first-match-wins a careless reorder is a silent
privilege escalation. With `deny` absorbing `allow`, adding a rule can only
tighten.

There is also a non-negotiable exec denylist — `vssadmin`, `bcdedit`, `takeown`,
`diskpart` and a few more — that no rule overrides, because those commands
defeat the sandbox itself. The list is deliberately short: a long denylist is a
poor substitute for a good allowlist and encourages an illusion of completeness.

### The audit log

Every record carries the digest of the one before it. That does not stop someone
who controls the machine from rewriting the whole file, but it does stop
selective edits — which is the realistic case: an agent, or a bug, quietly
dropping the record of one bad action.

### The path jail

`PathJail` is the single point where a virtual path becomes a real one, and it
fails closed. The threat model was written from CVEs: Windows device names
(`CON`, `NUL`), alternate data streams (`file.txt:hidden`), 8.3 short names
(`PROGRA~1`), trailing dots and spaces that Win32 silently strips,
case-insensitive comparison, and — most importantly — **re-checking after
symlink resolution**, because a junction inside the jail can point outside it.

`packages/core/test/vpath.test.ts` is the highest-value test in the repository.
A regression there is a sandbox escape, not a bug.

---

## Models and providers

PLIF includes an OpenCode Zen free path so a new installation can start with
the models explicitly marked `no key`, including `deepseek-v4-flash-free`.
`/model` is intentionally small: it derives its rows from providers available
right now instead of showing the entire built-in catalog. Provider details are
visible while you browse, including the serving provider, access mode, and
only the capabilities/context metadata that PLIF actually knows.

Want more models? Run `/providers`, choose a provider, and enter its API key
when prompted. Once that provider is configured, its usable models appear in
`/model` immediately; removing or changing the provider removes stale rows and
keeps the active selection on a usable route.

Rows with distinct visible names stay concise. A provider suffix is shown only
when two available providers would otherwise make the model name ambiguous.

The built-in NexAPI entry uses `https://nexapi.ebmtg1.easypanel.host/v1` and
the normal encrypted credential flow. Choose it from `/providers`, paste a key
when prompted, and PLIF validates the endpoint before saving anything. Models
are discovered live and kept stale only as a temporary fallback when a refresh
fails; API keys are never written to the model cache or status output.

`/models` opens with strongest-first ranking. Press uppercase `F` for the
compact browser menu and choose largest context, fastest, A–Z, provider, tier,
reasoning, tools, vision, coding, or long-context filters. Known metadata and
declared capabilities influence the score; unknown models remain visible but
are placed conservatively in Tier D.

## Models and vision

The active model and its capabilities live in `~/.plif/config.toml`. Plif does
not guess image support from a model name: a model is marked `[vision]` only
when its provider entry explicitly includes `"image"` in `modalities`.

An image-capable primary model receives pasted images directly. A text-only
primary can still work with screenshots and diagrams through `inspect_image`:
Plif sends the image and a focused question to a configured vision helper, then
returns that helper's textual observations to the primary model. The picker
marks that path as `[vision helper]`; the image endpoint and cost are disclosed
before first use.

```toml
model = "custom/text-primary"
visionModel = "custom/vision-helper"

[provider.custom]
name = "My OpenAI-compatible endpoint"
sdk = "openai"

[provider.custom.options]
baseURL = "https://models.example.com/v1"
needKey = true

[provider.custom.models.text-primary]
name = "Text primary"
modalities = ["text"]

[provider.custom.models.vision-helper]
name = "Vision helper"
modalities = ["text", "image"]
cost = "paid"
```

Set `model` to `custom/vision-helper` when you want direct vision instead. Keep
the text model as primary when it is better for coding or cheaper; `visionModel`
then gives it eyes only for the turns that need them. Plif still reads legacy
JSONC during migration, but saves current configuration and exposes its
configuration reference as TOML at `packages/core/schema/config.schema.toml`;
the former JSON schema is no longer shipped.

API keys do not belong in canonical `config.toml`. On Windows, Plif migrates
legacy `apiKey`, `providerKeys`, and provider-option keys into its DPAPI-backed
credential store before removing the plaintext fields. A provider-specific
environment variable remains the non-persistent override; the model picker can
collect and save a missing key without putting it in the transcript.

For isolated automation, `PLIF_CONFIG_PATH` can point at a different TOML file;
ordinary sessions continue to use `~/.plif/config.toml`.

## Waiting for long-running work

`start_task` uses PLIF's runtime `TaskMonitor`. It waits on native task
completion events first and uses a slow, adaptive check only as a fallback.
Those checks never call the model and never append polling messages to the
transcript. When the task finishes, fails, times out, or is cancelled, one
structured tool result returns to the existing agent loop so it can continue
with the original goal. Ctrl+C and session shutdown cancel the wait and clean
its listeners/timers.

## Research and Plif effort

The web tools have separate contracts:

| Tool | Use it for | Result |
| --- | --- | --- |
| `web_search` | One narrow query | Ranked discovery leads and snippets |
| `research` | A decision with several claims or search angles | A parallel, grouped, deduplicated discovery map with coverage status |
| `web_fetch` | Reading one selected source | Markdown with the source URL and an exact character range |

`research` accepts one objective and one to six `{ query, purpose }` entries.
The queries run concurrently but remain in the requested order. Blocked search
groups stay distinct from queries that genuinely returned no ranked results.
Snippets are leads, not evidence; the agent opens selected sources with
`web_fetch` before using them in a factual answer.

`web_fetch` accepts `focus`, `offset`, and `max_chars`. `focus` centres the
returned window on a term when present; `offset` pages through the reader text.
The result identifies the requested URL and character range, and the reader
stops after a bounded response instead of loading an unlimited page. The Jina
reader sees the requested URL, so Plif rejects credentials embedded in a URL
or credential-shaped query parameters. It also refuses local, private, reserved,
and metadata targets, strips fragments, and does not follow reader redirects.
The research prompt forbids sending private content through the reader.

Tool arguments are structured JSON objects on the model protocol. User
configuration is TOML. To enable the engineering workflow persistently:

```toml
effort = "plif"
```

You can also select it for the current setup with `/effort plif`. For an
OpenAI-compatible endpoint, Plif starts at the strongest wire effort and
negotiates downward only when the endpoint explicitly rejects that level;
Anthropic receives `max`. For an authorized code change, this effort requires
repository reconnaissance, a design and risk review, and a durable plan at
`.plif/plans/YYYY-MM-DD-<objective>.md` before implementation files change. It
also persists the visible checkpoint mirror at `.plif/plans/current.md`, assigns
independent work to bounded subagents, tests each checkpoint, reviews the
integrated diff, and runs an evaluator-correction loop before handoff.

## Language intelligence and code colour

Plif bundles language servers for TypeScript/JavaScript, JSON/JSONC, HTML, CSS,
SCSS, and Less. It also discovers project or `PATH` installations for Python,
TOML, Rust, Go, C/C++, Bash, and PowerShell. File edits request fresh diagnostics
from the responsible server; diagnostics from an older document version are
discarded, and changing workspaces shuts the previous manager down before a new
one starts. Windows `.cmd` and `.bat` server shims are launched through a quoted
`cmd.exe` invocation instead of relying on Node's unstable direct shim spawning.

Diffs and code shown while the agent works are syntax-coloured with semantic
roles from the active theme. The highlighter preserves the exact source text and
display width, so colour feedback cannot alter code or destabilize the terminal
layout.

The prompt modules that define tool calls, research, subagent coordination, and
the Plif workflow live under
`packages/core/src/agenting/instructions/20-runtime/`. They load only in the
modes and tool environments that can execute them. Contexts below 32k select
compact safety/workflow layers so the instructions do not consume the model's
entire working window; larger models receive the complete tutorials.

During active Plif work, the frame, input, thinking marker, dock, and context
meter use colour waves derived from the selected theme. Text, glyphs, wrapping,
and geometry stay fixed between animation frames. An idle prompt does not run
the animation clock; this keeps the Windows terminal stable instead of
repainting a black frame at rest.

Auto-compaction carries older chunks into one rolling continuity capsule. The
capsule retains the durable plan path, current checkpoint, opened-source ledger,
subagent status, failures, validation, and exact next action. A capsule that
drops a detected plan path is rejected without deleting the raw history, and
credential-shaped values are redacted before and after summarization. Plif also
generates concrete continuity anchors for each chunk; a generic capsule that
drops them is rejected without deleting the corresponding raw history.
Text attachments are carried in redacted, bounded form and image attachments
retain safe metadata while binary payloads stay out of the summarizer. If the
capsule provider fails, Plif reports it, disables that provider for the rest of
the turn, and falls back to protocol-safe mechanical trimming.

## Credentials

plif asks for an API key in the interface and encrypts it with your Windows
account through DPAPI. One record per name, under a hashed filename so that
listing the directory does not reveal which services you use.

The value reaches the code that needs it by resolving a promise and by no other
route. It is deliberately left out of the event that reports the answer, so
nothing subscribed to the event bus — the timeline, the transcript, the audit
log, the model's context — is in a position to leak it. The interface masks it
while you type, and the row recording the exchange says that something was
stored, not what.

Resolution order is environment, then encrypted store, then asking you. The
environment wins so `KEY=x plif ...` still overrides a saved value and CI never
sees a prompt.

## MCP

Both `mcp` and `mcpServers` are read from `~/.plif/config.toml`. Local servers
run over stdio; remote ones over HTTP.

```toml
[mcp.local]
command = "npx"
args = ["-y", "@modelcontextprotocol/server-github"]

[mcp.remote]
url = "https://service.example.com/mcp"

[mcp.keyed]
url = "https://service.example.com/mcp"

[mcp.keyed.headers]
Authorization = "Bearer ${MCP_API_KEY}"
```

`${VAR}` and `${VAR:-default}` expand from the process environment — literally
that, with no shell, no file reads and no expression evaluation. A header whose
variable resolves to nothing is omitted rather than sent empty, and plif tells
you which variable it wanted.

An HTTP server that answers `401` with OAuth metadata authenticates itself:
authorization code with PKCE through the official SDK, your browser on the
service's page, and an ephemeral listener on `127.0.0.1` waiting for the
callback — random port, `state` checked, single use, with a timeout. If no
browser can be opened the authorization URL is printed so you can finish by
hand, because the listener is already waiting either way.

This only happens in an interactive session. `plif prompt` never opens a browser
and never waits; the server is reported as disconnected with a reason telling
you to run `plif` in a terminal. A CI job must not block on someone clicking.

---

## Building from source

```powershell
git clone https://github.com/AnThophicous/plif
cd plif
npm ci
npm run build
npm test
npm run link      # puts your build on PATH as `plif`
```

`npm run dev` runs the CLI from source through tsx. `npm run preview` renders
the interface into stdout with a fake TTY, which is how the terminal layout gets
reviewed without a terminal.

## Status

Version 0.1.0. It is used daily by its author and it is early.

What is honestly not done: filesystem write blocking and network blocking are
not enforced at the OS level (see above), the sandbox is Windows-first because
that is where the isolation primitives are implemented, and the plugin
marketplace can install MCP servers but not the skills that many catalogue
entries ship as directories.

Bug reports that include what you expected and what happened are welcome. So are
disagreements about the security model, which is the part most worth arguing
about.

---

## Licence, and the name

Apache-2.0. Use it at work, fork it, build a product on it, sell what you build.

Two things the licence asks of you, and this project means both:

- **Keep the attribution.** Section 4 requires the `NOTICE` file to travel with
  anything you redistribute. Keep it where the people receiving your copy can
  read it.
- **Give your fork its own name.** Section 6 grants no rights to the name.
  "Built on plif" is accurate and encouraged; calling your product plif is not.
  [`TRADEMARK.md`](TRADEMARK.md) says exactly where that line sits.

---

## Who built this

**Anthophicous** — author. Direction, product decisions, the design of the
interface, and the judgement calls this whole thing is made of: what the sandbox
should refuse, what an honest degradation report looks like, what belongs on
screen and what does not. Every argument recorded in this README was settled
here.

The implementation was written with two models, working to that direction:

**Claude Opus 5** (Max Thinking) — the core runtime and most of what it is
argued about above: the container engine, the path jail and its CVE-derived
threat model, the policy precedence rule, the hash-chained audit log, the agent
loop and compaction, MCP with OAuth, the credential store, and the tests that
hold all of it in place.

**ChatGPT 5.6** (Sol) — the terminal interface and the session layer: the frame
budget that keeps Ink from repainting the world, the timeline and its scrollback
rules, the approval and question panels, and the model catalogue.

The division was never clean and neither model gets credit for the parts it got
wrong on the way. The direction was one person's throughout.

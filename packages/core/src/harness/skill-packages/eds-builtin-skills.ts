import type { Skill } from '../skills.js';

/**
 * Built-in skills shipped by Emanuel's 751f09a contribution.
 * Keep these as a single catalog group so their order and availability remain
 * deterministic while the Markdown-native copies are loaded from agenting.
 */
export const EDS_BUILTIN_SKILLS: readonly Skill[] = [
  {
    name: 'context-ingestion',
    description:
      'Normalize already-extracted file, web, and code content into source-attributed context for other skills; never extract, crawl, or persist by itself',
    scope: 'builtin',
    file: '<builtin>',
    instructions: `# Context Ingestion

Use this as an infrastructure step between extraction and reasoning. It accepts
already-extracted text from files, web pages, or code and returns predictable,
source-attributed context for another skill.

Rules:
- Never read file bytes, fetch URLs, crawl the web, execute code, or persist data.
- Preserve a stable source_id and locator on every chunk and fact.
- Keep extracted facts separate from AI-generated synthesis; label synthesis
  explicitly as ai_generated_synthesis.
- Preserve uncertainty and surface conflicts instead of silently choosing a side.
- Never invent missing information. Report it in missing_context.

Input shape:
{ sources: [{ source_id, source_type, origin, raw_content, extracted_by,
extracted_at, metadata }], purpose, allow_synthesis, conflict_tolerance }

Output shape:
{ status, data: { chunks, facts, synthesis, entities, missing_context },
qa_summary: { sources_processed, sources_rejected, unresolved_conflicts }, notes }

Reject sources without raw_content with a structured failure explaining which
dedicated extraction or fetch step must run first. This skill is stateless and
does not talk to the end user or complete the calling task.`,
  },
  {
    name: 'create-slide-deck',
    description:
      'Create a presentation-grade slide deck through requirements interview, real research, outline approval, visual system, and office-render hand-off',
    scope: 'builtin',
    file: '<builtin>',
    instructions: `# Create Slide Deck

Use whenever the user asks for a presentation, pitch deck, slideshow, or slide
file. Treat the workflow as an interview and approval gate, not a template.

1. Interview: resolve audience, purpose, length, format, source material, and
   visual direction. Do not guess decisions that materially change the deck.
2. Research: use real supplied or fetched sources. Never invent facts, numbers,
   quotes, case studies, or placeholder data presented as real.
3. Structure: turn source material into an outline and get approval before
   writing final slide content.
4. Design: define a reusable visual system, then specify content, hierarchy,
   layout, and visual evidence for every slide.
5. Build: hand the approved content and design system to office-render with
   format: pptx (or the format chosen in the interview).
6. Validate: inspect the rendered result and report missing rendering capability
   plainly; never silently downgrade to plain markdown.

When raw documents or web material are provided, pass already-extracted content
through context-ingestion before making content or design decisions. This skill
owns narrative and visual decisions; office-render only routes and validates.`,
  },
  {
    name: 'galileu',
    description:
      'Socratic decision review that ranks high-impact uncertainty, challenges assumptions, tracks contradictions, and closes with a decision record',
    scope: 'builtin',
    file: '<builtin>',
    instructions: `# Galileu

Use for high-impact, uncertain decisions, architectural forks, plans that need
stress-testing, or when the user invokes Galileu. It is grill-me's successor:
an interviewer and critic, not an exhaustive questionnaire.

For each pass:
1. Map the decisions and dependencies.
2. Rank them by impact, uncertainty, and irreversibility.
3. Verify answers from code, docs, skills, and tools before asking the user.
4. Ask only the highest-information question; state obvious risks directly.
5. Record the resolution and check for contradictions.
6. Stop when objective, constraints, high-impact decisions, alternatives, risks,
   and success criteria are explicit.

Every recommendation includes the option, reasoning, trade-offs, risks, and a
confidence level. Name contradictions and reopen only affected branches. Name
unnecessary complexity instead of allowing "maybe useful later" abstractions.

Close with a Decision Record containing objective, decisions and confidence,
alternatives rejected, risks, assumptions, deferred items, and next steps. Do
not execute code or persist the record automatically.`,
  },
  {
    name: 'office-render',
    description:
      'Thin routing contract for rendering finished content and design through pptx, docx, or xlsx skills without making content or design decisions',
    scope: 'builtin',
    file: '<builtin>',
    instructions: `# Office Render

Use as the final rendering contract after a calling skill has already decided
content, structure, and design. Route the finished spec to the appropriate
pptx, docx, or xlsx skill and return its authoritative result.

Input must include the requested format, finished content, and design_system.
Validate that the format is supported and that required content and design are
present. Do not invent content, choose a layout, rewrite the narrative, or
silently substitute another format.

Return a structured result with status, qa_summary, and file_path when a file is
produced. A file existing without a passing qa_summary is not a finished
deliverable. If no renderer is available, stop with an explicit failure and
identify the missing format skill. This layer routes and validates only; it
never makes content or design decisions and never persists unrelated data.`,
  },
];

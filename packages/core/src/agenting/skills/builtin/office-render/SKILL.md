---
name: office-render
description: Route finished, already-decided content and design to the correct pptx, docx, or xlsx renderer with structured validation results.
---
# Office render

This is a contract layer, not a content or design agent. The caller must provide
the format, finished content, design system, and output intent.

- Accept only `pptx`, `docx`, or `xlsx`; reject ambiguous formats.
- Do not invent narrative, choose colors, redesign layouts, or silently switch
  formats.
- Route to the matching specialized renderer and preserve its full QA process.
- Return a structured result with status, file path, format, validation summary,
  and notes. A file existing without passing validation is not success.
- If QA fails, return the file and the concrete failure so the calling skill can
  decide whether to revise or escalate.

The skill never talks to the end user directly, persists unrelated data, or
reports success without authoritative validation.


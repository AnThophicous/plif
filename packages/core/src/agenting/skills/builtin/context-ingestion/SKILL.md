---
name: context-ingestion
description: Normalize already-extracted file, web, and code content into source-attributed context for another skill without extracting, crawling, or persisting it.
---
# Context ingestion

Use this as the boundary between extraction and reasoning. It receives text that
was already read or fetched and returns stable, attributable context.

- Require every source to have `source_id`, `source_type`, `origin`,
  `raw_content`, `extracted_by`, and a useful locator when available.
- Preserve source attribution on every chunk and fact. Never merge facts from
  different sources without recording both sources.
- Keep extracted facts separate from AI synthesis. Label synthesis as generated
  interpretation and preserve uncertainty from the source.
- Detect conflicting claims and keep both sides; resolve only with explicit,
  low-stakes evidence such as authority or recency.
- Report missing context instead of inventing it.

This skill is stateless. It must not read files, fetch URLs, execute code, call
the user, or persist memory. If raw content is missing, return a structured
failure naming the extraction or fetch step that must happen first.


# Sifr design knowledge retrieval

The design corpus is a selective reference layer, not a prompt to preload. Read
this file first, then retrieve only the concepts needed for the product question.

## Retrieval contract

1. Extract the product job, audience, content shape, risk, platform and explicit
   constraints. A style word is a clue, not a complete direction.
2. Query `scripts/query_design_concepts.py` with the job and any references. The
   query ranks concepts by principles, content fit, product fit, use cases and
   tensions; it does not return a color preset or a copy-paste composition.
3. Read the top two to four records plus their evidence. Keep the context small;
   retrieve adjacent concepts only when a real tension or historical lineage is
   part of the decision.
4. Synthesize a dominant concept, bounded support concepts, inherited rules,
   rejected rules and conflicts in DesignDNA. Never merge incompatible concepts
   by averaging their adjectives.
5. Treat every record as research. The output remains a product-causal thesis,
   not a claim that the page is “in” a style. Mark uncertain history or visual
   interpretation as `INFERRED` or `HYPOTHESIS`.

## Retrieval budget

The baseline and expansion shards are merged at retrieval time, but the default
context is still at most four concepts, eight reference objects and 1,200 words
of extracted notes. Use `--top-k` to lower it; raising it requires a reason such
as a documented hybrid or an adversarial comparison. The full merged corpus
is never injected into a local repair.

## Routing boundaries

Sifr owns the experience fit, synthesis and DesignDNA. Orun owns whether a named
package, registry, runtime, shader, media engine or component is current,
compatible, licensed and safe. A concept result is not a library recommendation.

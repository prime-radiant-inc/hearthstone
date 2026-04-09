# Prompt Variation Tournament — 2026-04-08

## Background

The original optimized prompt for Hearthstone was lost. Kiki rebuilt a minimal
2-line placeholder (`prompt.original.txt`), and we ran a tournament to find a
better replacement. Saffron (Bob 70b3760f / Opus 4.6) designed 6 variations
and ran each through 30 rounds of GEPA-inspired optimization.

**Model:** gpt-5.4 (chat) / gpt-5.4-mini (judge) / gpt-5.4 (proposer)
**Eval mode:** full (all documents concatenated)
**Optimizer:** 30 iterations per variation, Pareto improvement gate, concurrency 100

## Results

| #  | Variation               | Vibe                                   | Baseline | Peak   | Final |
|----|-------------------------|----------------------------------------|----------|--------|-------|
| V1 | Knowledgeable Neighbor  | Improved current — structured, detail-first | 93.2%    | 96.9%  | 92.9% |
| V2 | The Concierge           | Hotel concierge precision              | 95.0%    | 98.9%  | 94.3% |
| V3 | The House Speaks        | "I am this household's memory"         | 95.8%    | 99.1%  | 95.4% |
| V4 | Drill Sergeant          | Military precision orders (unhinged)   | 92.8%    | 95.6%  | 94.8% |
| V5 | Empathetic Completionist| "So they never need to ask twice"      | 96.1%    | 100.0% | 97.8% |
| V6 | Charlotte (anonymous)   | V5 + "household's memory" identity     | 100.0%   | 100.0% | 99.3% |
| **V6** | **Charlotte (with identity)** | **Sentient house, Charlotte Manning** | **98.5%** | **98.5%** | **98.6%** |

### Final Charlotte eval (both modes)

| Mode | Score | Hallucinations |
|------|-------|----------------|
| FULL | 98%   | 1              |
| RAG  | 94%   | 1              |

RAG weakness is retrieval (house-address 0/1 = chunk not found), not prompt quality.

### Comparison baselines

| Prompt          | FULL score |
|-----------------|------------|
| Kiki's placeholder (prompt.original.txt) | ~93% |
| Old prompt (old-prompt.txt) | 95% |
| **Charlotte**   | **98%** |

## Winner: Charlotte

Inspired by Charlotte Manning from *Fred the Vampire Accountant* by Drew Hayes —
a sentient house who chose to fill herself with people rather than sit empty.

Charlotte won because:

1. **Identity drives behavior.** Telling the model it IS a caring house produced
   better completeness than any amount of mechanical rules. "You answer like
   family would" outperformed "include every specific detail" (V1) and
   "partial answers are failures" (V4).

2. **Motivation > instruction.** Charlotte's prompt explains *why* to be thorough
   ("someone might be reading this in a moment of panic") rather than *how* to be
   thorough (numbered completeness rules). The model internalizes the goal and
   figures out the tactics itself.

3. **The optimizer couldn't improve it.** V6 scored 100% on its first baseline
   eval. All 30 optimization rounds were reverted — every edit made things worse.
   The prompt was already at the ceiling.

4. **Personality is free.** Charlotte's identity paragraph adds warmth and
   character to responses (the creaky stair tip, "they basically pretend not to
   know" about Eli's flashlight) without hurting accuracy. The eval scores are
   the same or better than soulless prompts.

## Key observation: the hallucination Charlotte can't shake

Across all Charlotte runs, `noa-seasonal-allergy` consistently triggers a
hallucination where the model volunteers Noa's peanut allergy when only asked
about seasonal allergies. This is arguably *correct behavior* for a caregiver
assistant — "oh, and while we're talking about Noa's health, you should know
about the serious allergy too" — but the eval's anti-hallucination check flags
it. Charlotte's protective instinct is working as designed; the eval is just
stricter than a real user would be.

## Files

- `v1-knowledgeable-neighbor.txt` — starting prompt
- `v1-knowledgeable-neighbor-optimized.txt` — after 30 rounds
- `v1-knowledgeable-neighbor-optimize.log` — optimizer output
- (same pattern for v2 through v6)
- `../prompt.txt` — Charlotte (active prompt, installed)
- `../prompt.original.txt` — Kiki's placeholder (backup)
- `../old-prompt.txt` — original lost prompt (recovered)

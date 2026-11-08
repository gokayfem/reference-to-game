# Reference-to-game implementation prompt

Use the reference-to-game skill in this repository. Build a genuinely playable game from the supplied references and brief. Inspect the actual files first and identify which sources govern appearance, identity, mechanics, motion and UI. Preserve originals and distinguish observations from inferences and deliberate design choices. A link or a filename alone is not inspected evidence.

Style and colors are the first priority. Preserve semantic color relationships and coverage, silhouettes, proportions, materials, lighting, camera framing, motion language and interface. Choose 2D, 2.5D, 3D or a hybrid according to what best preserves the input. Do not impose a default bright low-poly style, fixed grid, nine scenes or a familiar game template. Build one small polished scene with a real action and HUD, compare it against the reference, and correct the largest visible mismatches before expanding scope.

Implement a coherent loop with actual input, state changes, feedback, goals, recovery and restart. Author missing rules explicitly instead of copying generated-video mistakes. Separate game rules from rendering; keep counters and UI tied to state; use stable entity/reward IDs. Follow the user's engine and platform constraints. Test a complete session through the actual controls and record it.

Use existing, procedural or fal-generated assets when they improve fidelity. Honor the user's generation authorization and budget. Verify current endpoint schemas, keep identity anchors throughout edits, prepare isolated assets for 3D generation, and inspect the results under runtime lighting. Save request IDs before polling, reconcile uncertain submissions and reuse accepted outputs. Never expose generation credentials in client code.

Work through visual refinement, production build, input-driven playthrough, restart and measured performance. Deliver editable source, controls, lockfile, runtime assets and provenance, reference comparisons, gameplay recording, validation evidence and honest limitations. Continue autonomously through normal reversible implementation work; do not stop at a plan, attractive screenshot or compile success. Do not publish without authorization.

For a concrete case-specific prompt, run `python3 skills/reference-to-game/scripts/r2g.py prompt PATH_TO_CASE --out IMPLEMENT.txt`.

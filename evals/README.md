# Agent evaluation protocol (not run)

The four worked games were created before packaging this skill. They do not establish a causal improvement from using it. This protocol is a proposed future evaluation, not a result.

Run each case once with the skill and once without it, on the same agent/model, budget, tooling and raw inputs. Use fresh workspaces, identical prompts and an agreed implementation time budget. Do not show the evaluator the intended design choices. Disable paid generation unless both runs have the same explicit allowance.

Cases should include: a portrait monochrome sketch; an isometric toy puzzle sheet; real footage with no UI; a mixed image/clip with conflicting character colors; audio plus text with no visual source; a GLB plus a constrained mobile brief. Add near misses: only summarize a video, only generate a promotional image, only fix a CSS typo.

Review dimensions independently: palette/shape/material/camera/UI fidelity, identity consistency, actual playability, rule invariants/restart, evidence honesty, asset cost discipline and input transfer. Reviewers should see matching gameplay captures and source, not just a cherry-picked hero screenshot. A functioning app does not offset an identity failure. Record remaining differences and blocked actions.

Use negative controls: change the palette, duplicate an entity, fake a counter, freeze interaction, omit restart, substitute a prerecorded video, or provide a stale comparison. The review protocol should detect them. Publish raw findings and uncertainty; do not combine subjective scores into an unsupported universal success percentage.

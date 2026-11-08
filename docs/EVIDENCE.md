# Evidence and limits

Validation performed for the initial repository on **2026-11-09** (Europe/Istanbul). The reusable skill was assembled after the four example games were completed. Historical case reports and freshly rerun repository checks are distinct below.

## Fresh checks

| Check | Observed result | What this establishes |
|---|---|---|
| Python toolkit suite | 25 tests passed | Mixed input intake, byte preservation, link-only handling, no overwrite, path confinement, unusual image dimensions, transparent palette rejection, video extraction, review freshness, tampered evidence, offline viewer escaping, copied-skill portability, fal deduplication/ambiguity/budget guards |
| JavaScript runtime suite | 7 tests passed | Render-cadence-independent simulation, bounded stalls, once-only rewards, swept collisions, damping, input cleanup and deterministic seeds |
| Jetboat example | 16 tests passed; clean install and production build passed | Rule boundaries and reproducible copied source/build |
| Jellyworks example | 18 tests passed; clean install and production build passed | Solved layouts complete; initial defects block; routing, recipes, budgets and duplicate handling |
| Petal Pals example | 21 tests passed; clean install and production build passed | Rules, save/restore and connected navigation paths |
| Train Battle example | 24 tests passed; clean install and production build passed | Combat, collision and progression boundaries |

The copied examples build with their original lockfiles. Their dev tools include historical dependency versions; a successful build is not a claim that those are the preferred versions for a new project. The new toolkit ran locally on macOS with Python 3.9 and Node 26.12.0; documented support targets Python 3.10+ and Node 20+, with CI on Python 3.12/Node 22. Image and video checks used Pillow and ffmpeg/ffprobe. No paid model calls were made while creating or testing this repository.

## Historical case evidence

Each `examples/*/HISTORICAL-REPORT.txt` records the original implementation session's input-driven playthroughs, captures, performance measurements, asset jobs and remaining gaps. The original reference comparisons were visually inspected for this repository. The full historical recordings and multi-gigabyte generation archives are not included in Git. Their original file paths describe that production workspace and are not promised as links in this checkout.

Fresh install/test/build checks above do not mean a new full browser playthrough was rerun for each copied example. The root `review.json` files deliberately remain pending, so old outcomes are not silently treated as a fresh source-bound review.

## What is not proven

- No controlled with/without-skill agent evaluation has been run. [Proposed protocol](../evals/README.md).
- The examples do not establish universal fidelity across inputs, engines or devices.
- Palette samples are encoded RGB observations, not recovered physical material values. ICC conversion is not performed by the sampling helper.
- Frame extraction is for inspection; it records requested times and is not an exact PTS motion-analysis system.
- Review evidence is an author's attestation. Hashes catch changed files; they do not judge whether a scene looks right or a claimed test actually happened.
- The fal adapter is tested with fake transports. It does not guarantee exactly-once remote execution or enforce a provider-side spending cap.
- New Unity, Godot or Unreal implementations can use the contracts, but no verified engine project generators are included.

Every result should retain its scope. Do not turn these specific checks into an unsupported overall similarity or success percentage.

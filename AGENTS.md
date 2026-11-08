# Repository development

This repository packages a reference-guided game-building skill and reusable tools. Preserve input neutrality: no built-in genre, daylight, camera, palette, scene count, proprietary model or example-specific entity in the shared workflow. Keep successful examples separate from reusable code.

All installable dependencies of the skill live inside `skills/reference-to-game/`. A copied skill folder must work without the rest of the repo. Add detailed conditional guidance to `references/`; keep SKILL.md readable. Do not copy credentials, signed media URLs, absolute author-machine paths or private generation ledgers into examples.

Before changes ship, run `python3 -m unittest discover -s tests -p 'test_*.py' -v`, `node --test tests/runtime.test.mjs`, and `python3 tests/check_repo.py`. Changes to an example must also run its build and relevant tests. For new intake modes, include a case outside this repository with unusual dimensions or a new modality. Test negative behavior: changed references, stale review, path escape, duplicate generation and ambiguous network outcomes.

Never claim a CLI attestation proves visual fidelity. Keep documented evidence, observed test results and proposed evaluations distinct. Do not run paid inference in CI. Do not loosen checks merely to make a case pass.

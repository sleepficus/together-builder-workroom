# Builder Workroom — measured verification

Verified October 28, 2026 by Main Chad, independently of Command's backend, Way's frontend and the fresh coding participant. Scope: an installed local, bounded Together coding workroom using real Builder Agent-Native actions. This is not a public deployment or competition submission.

## Real user journey

Main created task `e6eb560e-60de-4038-a465-f102810585b6` through the actual browser with only a prompt and the visible default acceptance notes. A fresh Codex participant discovered all nine tools over HTTP MCP, claimed that task, reread revision 2 and read the actual brief, frozen tests and unimplemented source. Main then changed the request through the UI, producing revision 3 and requiring an explanatory code comment.

The participant deliberately attempted one write using revision 2. The server refused it, and the original source SHA-256 remained `d114300fa367e0cf5e2d43fb26b0b408d7840b0dfe9659a4825586cd9ace9074`. The participant reread revision 3, changed only `summary.mjs`, verified the frozen inputs were unchanged, requested the fixed check and posted the actual result. Main independently reviewed the code, diff, collector receipt and visible result.

- Candidate: `bd6d1b68bf242c21383b5f2e31d0c7d03d1359ed`.
- Verification: `f4ff8755-8a88-48ae-aecd-23cce0a4657c`.
- Fixed check: **10 passed, 0 failed, 0 skipped**.
- Output SHA-256: `f95d29e64bd6280893b111e90f17144cd662f3e2374567bdb07897d5b57b95d2`.
- The candidate, job and collector receipt name the same immutable code version.
- The rendered output equals the saved output byte for byte; the rendered diff equals it apart from a final newline.
- Main stopped and restarted only the independent instance, retained its browser sign-in, and retrieved the identical result using the existing scoped agent config.
- Main signed into a second Builder instance on the same hostname and reloaded the first: both stayed usable after the cookie repair.
- An unauthenticated live MCP request returned 401.
- Main inspected the desktop result and the 390 × 844 browser layout; document width remained 390 with scrollable code panes. No physical iPhone test is claimed.

The agent performed real model work through MCP; Main controlled the timing of the interjection to test recovery. Command and Way also used a separately labelled no-model fixture for their own plumbing/UI checks. Those are different runs and are not blended.

## Tests and independent review

| Evidence | Result | Owner |
|---|---|---|
| Broader local suite before the new standalone CLI | 529 total: 528 pass, 0 fail, 1 optional skip | Command |
| Final integrated Builder action/setup/CLI/UI suite | 40 pass, 0 fail, 0 skip | Main |
| Standalone official HTTP SDK CLI tests | 9 pass; included in the final 40 | CLI builder, rerun by Main |
| Frontend focused tests | 12 pass; included in the final 40 | Way |
| Typecheck and production build | Passed | Command and Way |
| Actual agent check-summary exercise | 10 pass, 0 fail, 0 skip | Fresh participant; inspected by Main |

The counts overlap where stated; they are not summed into a headline total. The optional Docker test was skipped, not passed. Two optional hosted-OAuth files are excluded by the inherited local runner. Command reproduced an unrelated stale dashboard text assertion on pristine baseline source before changing that assertion to the actual existing label.

Main reviewed shared action/input declarations, scope refresh, revision/claim guards, serialized file effects, uncertain-operation records, immutable candidate/check linkage, cookie isolation, private setup and the shipped SDK client. Main also tested the real browser and protocol path described above. Builders installed, tested and self-reviewed before this independent closure; their reports are retained in the deliverable evidence.

## Repairs found during the build

The first frontend contract disagreed about optional acceptance notes and page size; the real prompt-only path and compatible page limit now work. Result freshness initially used the whole task revision, which incorrectly treated status-only progress as changed requirements; it now compares the saved goal and acceptance content. Backend self-review closed a queued stale-scope window. Concurrent actual browser tests exposed a shared cookie name across ports; Builder now derives a stable installation-specific name while preserving HttpOnly, SameSite, path and origin checks.

Failed test attempts and the baseline control are preserved in the evidence packet. Previous RC3 results remain historical and do not certify this new branch.

## Limits and honest state

This entry uses one check-summary workspace, three readable files, one editable file and a fixed local Node check. It does not expose arbitrary shell access, dispatch providers, automatically wake agents, merge code or offer a general hostile-code sandbox. The independent review is recorded as evidence and a shared message; it does not fabricate a structured candidate approval. The demonstration candidate remains unmerged, and the task claim expires normally.

The entry uses pinned `@agent-native/core@0.221.0` actions and its official MCP transport; it retains Together's own persistence/auth and does not claim the framework's full application scaffold, native chat, A2A or database layer. Optional OpenTelemetry is absent. SQLite experimental and Vite large-chunk warnings remain. The first UI shows ten recent tasks and five result summaries; larger history navigation is a future product increment.

No public upload, deployment, registration or entry submission occurred. Questions for Stephen: none for the local build; public recording/submission is a separate next step.

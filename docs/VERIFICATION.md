# Verification status

This public build is a **developer preview**. Local execution was on Windows 11 (10.0.26300), Node.js 24.15.0. No public-build Premiere installation was tested.

| Check | Status |
|---|---|
| Fresh source build and credential-free tests | Verified locally; CI runs on Windows and Linux |
| Reference pacing changes actual V2 plan from 6 to 12 shots | Verified, deterministic fixture inference |
| HTTP reads/writes and WebSocket authentication | Verified against real loopback HTTP/WebSocket server with simulated host |
| Partial graphics and rough-cut writes; restart/replay | Verified in ExtendScript host simulation |
| One-, two-, five-track graphics allocation | Verified in host simulation |
| Manual target conflict preservation | Verified in host simulation |
| Original shape motion media | Generated locally using FFmpeg |
| Original Arabic neutral raster graphic | Rendered with installed system font; not a Premiere frame |
| Local Python/media fidelity integration | Verified on synthetic PCM through pinned resolver; separate from default tests |
| Codex CLI 0.167.2 login/flags and synthetic structured inference | Verified; no entitlement claim |
| Paid Audio API transcription | Not executed |
| Real CEP handshake, Premiere insertion/rendering and restart recovery | **Pending; no Premiere version verified** |
| Automatic final video export | Not implemented; manual |

Reproduce with `npm ci`, `npm test`, and `npm run demo`. Integration checks are explicit and never run in the default CI. Do not infer live Adobe compatibility from host mocks. See `PREMIERE_ACCEPTANCE.md` for remaining acceptance.

## Agent workflow update

22 credential-free tests cover the current two-agent example, explicit source choice, reference read-only access, versioned names, local mappings, minimized prompts, changed-input cloud approval and owned overlay insertion. The actual panel was exercised in a local Chromium browser fixture (`npm run test:panel`); this is not CEP/Premiere acceptance. The optional HTML/CSS renderer smoke test (`npm run test:renderer`) passed locally with ProRes alpha metadata/decoded alpha checks. The shown Arabic lower-third sample and FFmpeg composite were visually reviewed. The 20-second public animation is a simulated workflow driven by actual fixture plans, not an Adobe recording.

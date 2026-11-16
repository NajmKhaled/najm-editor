# Providers and data boundaries

## Default: fixture and local data

`npm run demo` uses `FixtureModelProvider`, a supplied Arabic transcript, synthetic reference snapshots and original shape SVG proxies. It never invokes Codex, ASR, an Audio API or a download. It runs the existing V2 planner and validators. SVG duration/FPS are declared fixture metadata. `npm run demo:media` separately generates real MP4 motion footage and a silent WAV with installed FFmpeg.

Default provider mode refuses arbitrary real-project inference. A failure never selects a cloud provider automatically. Real project files and personal style material are absent from this release.

## Optional Codex CLI: synthetic inputs only in this preview

Before enabling, review the data that a planning call would send: transcript text and timestamps, typed instructions, selected rule values, candidate labels/durations and explicitly attached contact-sheet images. Absolute execution paths stay local. Physical folder/bin labels are omitted unless explicitly enabled. Local run directories can contain sensitive data; do not publish them.

Check the installed CLI without inference:

```sh
node scripts/check-codex.mjs
```

For the tiny published synthetic provider test only:

```powershell
$env:NAJM_MODEL_PROVIDER='codex'
$env:NAJM_CLOUD_CONSENT='transcript-images-rules'
node scripts/check-codex.mjs --live
```

That test sends one original Arabic sentence, one shape label and one candidate ID; no images, private paths or personal rules. It validates the structured result. Remove those environment variables to return to fixture mode.

CLI 0.167.2 was checked locally for version, ChatGPT login and required flags. A synthetic structured inference completed with no tool-action event accepted. The provider disables known execution, browser, image-opening, app/plugin, agent and code-host surfaces, ignores user configuration/rules, uses an ephemeral read-only sandbox and rejects unexpected item events. A known startup notice that code mode is unavailable is accepted as a notice, not a tool action. This is **not a general filesystem-isolation guarantee**; the preview deliberately refuses non-synthetic inference. No subscription tier, quota, chosen-model entitlement or universal CLI compatibility is claimed.

Official references checked for this integration: [CLI reference](https://developers.openai.com/codex/cli/reference), [authentication](https://developers.openai.com/codex/auth), [configuration](https://developers.openai.com/codex/config-reference). Authentication through ChatGPT is separate from an Audio API credential. Access and usage terms depend on the account and current OpenAI offering.

## Optional Audio API

The captions-only adapter uses OpenAI's timestamped transcription endpoint and requires both `OPENAI_API_KEY` (or `NAJM_OPENAI_API_KEY`) and explicit `NAJM_AUDIO_API_CONSENT=upload-audio`. Audio leaves the machine in prepared chunks; separate API access and billing apply. A missing credential, consent or request failure stops processing. No Whisper fallback occurs. Word timestamps are unavailable for this adapter. Chunk boundaries and uncertain words require review.

This adapter and caption-review path are experimental, not live-paid-API accepted. The preview's synthetic-only provider restriction also applies to downstream review; do not enable the adapter for private projects. The original local workflow remains outside this public release.

Local ASR loads an explicitly cached Whisper file or a local-only faster-whisper cache. It does not silently download weights. Python launches go through the pinned resolver. FFmpeg and font rendering remain local.

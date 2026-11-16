# Original lower third — optional proof of concept

The existing-asset path is a compatible local MOGRT mapped and tested by its editor. The mapping stores a local path, SHA-256 and editor-confirmed compatibility. A file extension or exposed reference component does not establish compatibility. Changed/missing files stop the run until remapped. Private font notes and template paths are excluded from model preferences.

For new graphics, `najm.lower-third.v1` is an original first-party HTML/CSS design. Its contract accepts text, frame-aligned start/end, supported dimensions/fps and a constrained style: charcoal background, mint/lavender accent, left/right position, scale 0.85–1.15. It rejects extra HTML/CSS/URLs, unknown presets, unsupported formats and out-of-range timing. User text enters the page through `textContent`. No remote resources or bundled fonts are used.

The optional local renderer captures transparent browser frames, encodes ProRes 4444 with FFmpeg and checks duration, frame rate, dimensions, aspect ratio and decoded alpha. Transparent first/last frames and a visible middle are required. The renderer is dynamically loaded only when requested; missing tools are reported as an explicit fallback in an enabled run. They do not trigger downloads or cloud fallback.

```sh
npm run demo:lower-third
npm run test:renderer
```

Outputs remain under ignored `demo/output/` or the local run directory. The panel exposes heading/second line, accent, position, duration and text scale. A blank heading uses the planned title. A provider returns the structured selection; local validation remains authoritative. Model planning does not receive asset binaries, local paths or font notes. Cloud disclosure includes optional lower-third text/style when enabled.

Host insertion uses an owned dedicated track through `applyOverlayBatch`. Existing mismatched/manual placements are preserved and cause a conflict. Repeating a verified placement does not add another clip. Structural host tests cover this behavior.

**Verified locally:** 1280×720, 24 fps, one- and two-second ProRes alpha samples; Arabic shaping in the shown sample; FFmpeg compositing; input validation and host simulation. This does not verify every language/font combination.

**Pending:** real Premiere Pro import, alpha interpretation, layer compositing, frame timing, restart recovery and font rendering. No supported Premiere instance was available. Do not add more presets based solely on local renderer success. The overlay is a rendered video, not an editable native MOGRT. Final export remains manual.

Implementation references: [Playwright screenshots](https://playwright.dev/docs/screenshots), [FFmpeg ProRes encoder](https://ffmpeg.org/ffmpeg-codecs.html#ProRes). Browser and FFmpeg are separately installed tools, not shipped binaries.

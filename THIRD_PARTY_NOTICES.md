# Third-party notices

No third-party dependency binaries, font files, Adobe templates or media are bundled in this source repository. Dependencies are installed separately through the pinned npm lockfile.

| Dependency | Purpose | License / source |
|---|---|---|
| `ws` | Local WebSocket transport | MIT; [upstream](https://github.com/websockets/ws); notice in `third-party/ws-LICENSE.txt` |
| `@resvg/resvg-js` | Local original SVG/Arabic raster graphics | MPL-2.0; [upstream source and transitive components](https://github.com/thx/resvg-js); license in `third-party/resvg-LICENSE.txt` |
| TypeScript | Development compiler | Apache-2.0; [upstream](https://github.com/microsoft/TypeScript) |
| `@types/node`, `@types/ws`, associated type dependencies | Development type definitions | MIT; [DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) |

Optional separately installed tools retain their own terms: FFmpeg, Python, Torch, Whisper, Pillow, Codex CLI and Adobe Premiere Pro. They are not redistributed here. System fonts are used through the local renderer; zero font binaries are included. Preview images contain original shape artwork and rendered text, not private template content.

Original demo source is in `demo/assets`, `demo/run.ts`, `demo/media.ts`, `demo/preview.ts`, and `packages/v2/neutral-graphics.ts`. It was created for this public example. No project-wide license has been supplied or applied. Third-party licenses do not license NajmEditor itself.

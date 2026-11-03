# Video generator

Turns a text prompt into a short MP4. Claude Code is the only AI: it writes a three.js scene as
code, and the local renderer captures it frame by frame.

**Hard constraint:** everything runs on this machine with no API keys, paid services, image or
video models, or downloaded assets. Don't add anything that breaks this.

## Layout

- `.claude/skills/video/SKILL.md`: the prompt-to-video workflow and the scene contract
- `src/generate.mjs`: CLI that runs the skill through `claude -p`
- `src/render.mjs`: starts a local server and headless Chrome, and pipes frames to ffmpeg
- `src/runtime/`: browser side (frame loop, virtual clock and seeded RNG, `kit` helpers)
- `videos/<slug>/scene.js`: generated scenes, with `video.mp4` and `preview.png` beside them

## Commands

- `npm run generate -- "prompt"`: full pipeline
- `node src/render.mjs videos/<slug>/scene.js`: render to `video.mp4`
- `... --preview`: 4x3 contact sheet at `preview.png`
- `... --at <seconds>`: one full-resolution frame

## Invariants

- Renders are deterministic: same scene and seed, same frames. Scenes see a virtual clock.
- Every frame runs in order, even in preview, so stateful simulations stay valid.
- Requests off the local server fail the render.

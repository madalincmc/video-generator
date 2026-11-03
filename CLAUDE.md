# Video generator

Turns a text prompt into a short MP4, or a live animation for a website. Claude Code is the only
AI: it writes a three.js scene as code, which is either captured frame by frame or bundled to
run on the page.

**Hard constraint:** everything runs on this machine with no API keys, paid services, image or
video models, or downloaded assets. Don't add anything that breaks this.

## Layout

- `.claude/skills/video/SKILL.md`: the prompt-to-video workflow and the scene contract
- `.claude/skills/hero/SKILL.md`: the prompt-to-live-animation workflow and hero scene contract
- `src/generate.mjs`: CLI that runs a skill through `claude -p`
- `src/render.mjs`: pipes frames from headless Chrome to ffmpeg
- `src/hero.mjs`: bundles a hero with esbuild and enforces its budgets
- `src/browser.mjs`: the local server and locked-down headless browser both of them use
- `src/runtime/`: browser side (frame loop, virtual clock and seeded RNG, `kit` helpers, and
  `hero-mount.js`, the page runtime bundled into every hero)
- `videos/<slug>/scene.js`: generated scenes, with `video.mp4` and `preview.png` beside them
- `heroes/<slug>/scene.js`: generated heroes, with `dist/hero.js` and `preview.png` beside them

## Commands

- `npm run generate -- "prompt"`: full video pipeline
- `npm run hero -- "prompt"`: full hero pipeline
- `node src/render.mjs videos/<slug>/scene.js`: render to `video.mp4`
- `... --preview`: 4x3 contact sheet at `preview.png`
- `... --at <seconds>`: one full-resolution frame
- `node src/hero.mjs heroes/<slug>/scene.js [--out <dir>]`: build and check, copying on success

## Invariants

- Renders are deterministic: same scene and seed, same frames. Scenes see a virtual clock.
- Every frame runs in order, even in preview, so stateful simulations stay valid.
- Requests off the local server fail the render or check.
- Hero scenes depend only on `t` and `pointer`, so they stay stable however long a page is open.
- Hero budgets run on the integrated GPU, the closest thing here to a visitor's laptop.
- `generate` lists both Bash and PowerShell rules, since Windows sessions may use either shell.

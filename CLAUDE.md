# Video generator

Turns a text prompt into one of two separate outputs. Claude Code is the only AI: it writes a
three.js scene as code, which is then either captured frame by frame or bundled to run on a page.

**Hard constraint:** no API keys, paid services, image or video models, or downloaded assets.
Apart from Claude Code itself, everything runs on this machine. Don't add anything that breaks
this.

## Layout

- `.claude/skills/video/SKILL.md`: the `/video` workflow and scene contract
- `.claude/skills/hero/SKILL.md`: the `/hero` workflow and scene contract
- `.claude/skills/blender-video/SKILL.md`: the `/blender-video` workflow and scene contract
- `src/run-skill.mjs`: runs a skill through `claude -p`
- `src/video/`: `render.mjs` pipes frames from headless Chrome to ffmpeg; the rest is its page
- `src/hero/`: `build.mjs` bundles with esbuild and enforces budgets; `mount.js` is the page runtime
  bundled into every hero; `test-page.*` is the harness the budgets run in
- `src/blender-video/`: `render.mjs` starts Blender and encodes; `runner.py` runs inside Blender with
  the scene guard; `kit.py` holds the scene helpers
- `src/shared/`: `browser.mjs` (local server, locked-down browser), `kit.js` (scene helpers)
- `videos/<slug>/scene.js` or `scene.py`: generated scenes, with `video.mp4` and `preview.png` beside them
- `heroes/<slug>/scene.js`: generated heroes, with `dist/hero.js` and `preview.png` beside them
- `docs/`: one guide per output, plus `costs.md`; `media/` holds their images and clips

## Commands

- `npm run video -- "prompt"`: full video pipeline
- `npm run hero -- "prompt"`: full hero pipeline
- `npm run blender-video -- "prompt"`: full Blender video pipeline
- `npm run render -- videos/<slug>/scene.js`: render to `video.mp4`
- `... --preview`: 4x3 contact sheet at `preview.png`
- `... --at <seconds>`: one full-resolution frame
- `npm run hero:build -- heroes/<slug>/scene.js [--out <dir>]`: build and check, copying on success
- `npm run blender:render -- videos/<slug>/scene.py [--preview | --range <from> <to> | --at <s>] [--max-minutes <n>]`

## Invariants

- Renders are deterministic: same scene and seed, same frames. Scenes see a virtual clock.
- Every frame runs in order, even in preview, so stateful simulations stay valid.
- Requests off the local server fail the render or check.
- Blender scenes only ever use procedural content: `runner.py` fails on external files, and its guard
  blocks network, programs and outside writes. That guard is not a security sandbox.
- Blender output stays short, because every line Blender prints would otherwise cost Claude's usage.
  Keep showing only `[bv]` lines by default.
- Blender is an installed prerequisite, like Chrome or Edge, and it stays local.
- Hero scenes depend only on `t` and `pointer`, so they stay stable however long a page is open.
- Hero budgets run on the integrated GPU, the closest thing here to a visitor's laptop.
- `run-skill.mjs` lists both Bash and PowerShell rules, since Windows sessions may use either shell.
- Skills invoke scripts as `node src/...`, and those exact paths are in their permission rules. If
  a script moves, update both the skill and `run-skill.mjs`.
- Update `docs/costs.md` when you add measured runs. Don't quote token or price figures from memory.

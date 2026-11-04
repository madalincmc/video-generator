# Blender videos

Use this when you want the **best-looking video file** and can wait for it. Claude writes a Python script that builds the whole scene in Blender, and Blender's Cycles path tracer renders it with real light, soft shadows, depth of field and motion blur. For a video in about a minute of rendering, see [MP4 videos](mp4-videos.md).

| | [MP4 video](mp4-videos.md) (`/video`) | Blender video (`/blender-video`) |
|---|---|---|
| **Claude writes** | three.js code | Blender Python |
| **Rendered by** | Your GPU, in headless Chrome | Your GPU, with Cycles in Blender |
| **Light** | Approximated | Physically simulated |
| **Fur, grass, hair** | Hand-built approximations | Real strands |
| **Render time** | Seconds to about a minute | Often tens of minutes |
| **Also needs** | Chrome or Edge | [Blender](https://www.blender.org/download/) 5.x |

## Make a video

```bash
npm run blender-video -- "a lighthouse in a storm at night, waves breaking on the rocks"
```

Or open Claude Code in this folder and type:

```text
/blender-video a lighthouse in a storm at night, waves breaking on the rocks
```

The result is saved to `videos/<slug>/video.mp4`. Blender is found automatically on your `PATH` or in its default Windows and macOS install folders. If yours is elsewhere, set `BLENDER_PATH`.

## What the `/blender-video` skill does

A skill is a set of written instructions that Claude Code follows when you call it. This one lives in [`.claude/skills/blender-video/SKILL.md`](../.claude/skills/blender-video/SKILL.md).

1. **Plans.** Chooses the format, timed beats, lighting and lens, and a render budget.
2. **Writes the scene.** Creates `videos/<slug>/scene.py`, using [`kit.py`](../src/blender-video/kit.py) for cameras, materials, terrain, scattering, hair, rigs and more. Nothing is downloaded.
3. **Checks its own work.** Renders a quick 12-frame sheet, which also reports blown-out, dark or unchanging frames. It then checks dense sheets of the fast moments, because motion problems hide in evenly spaced stills.
4. **Checks the budget.** Renders one final-quality frame, estimates the total time, and simplifies the scene if it's over budget.
5. **Renders and reports.** Long renders run in chunks and pick up where they left off, then ffmpeg encodes the MP4.

## Change a video without using Claude

Edit `scene.py` yourself and re-render. These commands **don't use Claude or any tokens**:

```bash
npm run blender:render -- videos/<slug>/scene.py                  # full video, saved as video.mp4
npm run blender:render -- videos/<slug>/scene.py --preview        # 12-frame sheet, saved as preview.png
npm run blender:render -- videos/<slug>/scene.py --range 2 4      # 12 frames from 2s to 4s, saved as range.png
npm run blender:render -- videos/<slug>/scene.py --at 2.5         # one final-quality frame
npm run blender:render -- videos/<slug>/scene.py --max-minutes 9  # stop after 9 minutes, run again to resume
```

Finished frames stay in `videos/<slug>/frames/`, so an interrupted render resumes where it stopped. Changing `scene.py` discards them, because they no longer match.

## Safety

Unlike three.js scenes, which run inside a locked-down browser, Blender scenes are Python with access to your computer. Before running a scene, the runner blocks Python from using the network, starting programs, and writing or deleting files outside the scene's folder. The render also fails if the scene loads an external image, model, sound or video.

**This is a guard rail, not a security sandbox.** It stops mistakes, and it can't contain code written to get around it. Only render scenes you trust, and read any `scene.py` you get from someone else first.

## Speed and cost

Generating draws on your Claude Code usage at no additional cost, and rendering uses only your machine. In the one full run measured, a 6-second storm scene took 44 minutes, 23 of them the final render, and used about 5.1 million tokens, roughly three times what the measured three.js videos used. One run isn't an average, so expect it to vary by prompt. See [What it costs](costs.md).

## Limitations

- **Slow on a laptop.** Render time adds up quickly, and it depends heavily on hair, volumes and resolution.
- **GPU memory.** A 6 GB GPU limits how much hair and geometry fits in a scene.
- **Characters are still hand-built from code.** Lighting and materials improve far more than anatomy and animation do.
- **Reviewed by stills.** Dense sheets help, but Claude still doesn't watch playback.
- **No sound.** Videos are silent.
- **Renders aren't checked for byte-identical output.** Scenes use fixed seeds, but unlike the three.js pipeline this hasn't been verified.
- **Tested on Windows with an NVIDIA GPU only.** It falls back to the CPU without a supported GPU, and that's untested and would be far slower.

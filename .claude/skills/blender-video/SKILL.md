---
name: blender-video
description: Generate a higher-quality short video from a text prompt by writing a Blender Python scene and rendering it locally to MP4 with path tracing. Use when the user asks for a Blender video, or for realistic lighting, fur, hair, grass or materials. It is much slower to render than the video skill.
argument-hint: <what the video should show>
allowed-tools: Read, Write, Edit, Glob, Grep, Bash(node src/blender-video/render.mjs:*), PowerShell(node src/blender-video/render.mjs:*)
---

Make a short video of: **$ARGUMENTS**

You are the only AI in this pipeline. Everything on screen must come from Python you write:
modeling, materials, rigs, animation, lighting. No image or video models, no API keys, no
downloads, no external files, and nothing from Blender's bundled asset libraries. The render fails
if a scene loads an external file. Scenes may not use the network, start programs, or write outside
their own folder.

## 1. Plan

Pick a short kebab-case slug and create `videos/<slug>/scene.py`. If the folder already exists and
the prompt is a new idea, pick a different slug. If the user is revising a video, edit its existing
scene.

Decide before writing code:

- **Format.** Default 1920x1080, 6 seconds, 24 fps. Use 1080x1920 if the prompt mentions vertical,
  shorts, reels or TikTok. Respect any duration given, and warn if it is over 15 seconds.
- **Beats.** Write 2 to 4 timed beats as a comment at the top of the scene. Every video needs a
  beginning, a change and an ending.
- **Look.** Choose a real-world reference for the light and lens: time of day, weather, focal
  length, and what is in and out of focus.
- **Render budget.** Aim for 30 minutes or less on this machine unless the prompt asks for more.
  Every shot and hero object you add costs time, so favor fewer, better shots.

If the prompt asks for something that can't be convincing in procedural 3D, such as real people or
live footage, make a stylized interpretation and say so in your final message.

## 2. Write the scene

Read `videos/example-blender/scene.py` for a working reference and `src/blender-video/kit.py` for
the helpers. The contract:

```python
import bpy
import kit

config = dict(duration=6, fps=24, width=1920, height=1080, seed=1, samples=24)
# Optional: engine='EEVEE', motion_blur=False, shutter=0.5, exposure=0.0, look='AgX - Punchy',
# noise_threshold=0.02, bounces=8, simulate=True (physics that must step through every frame)

def build(ctx):
    # Runs once. Build the world and keyframe everything here, then Blender plays it back.
    # ctx.fps, ctx.duration, ctx.width, ctx.height, ctx.seed, ctx.low_quality
    ...
```

The kit covers `camera`, `cut`, `animate`, `key`, `wobble`, `material`, `animate_glow`, `sky`,
`gradient_world`, `light`, `haze`, `mesh`, `sphere`, `box`, `cylinder`, `loft`, `terrain`,
`lathe`, `displace`, `subdivide`, `fbm`, `library`, `scatter`, `hair`, `rig`, `pose`, `text` and `rng`.
Use `bpy` directly for anything else. Use Blender 5 APIs: new materials and worlds already have node
trees, so don't set `use_nodes`. Use only seeded randomness, through `kit.rng`.

What makes this look better than a game engine, so use it:

- **Real scale.** Build in meters. Light, depth of field and motion blur all depend on it.
- **No flat surfaces.** Give every material `variation`, `bump` or `wear`. Perfect surfaces look fake.
- **Real light.** Use one clear key light and let bounces fill the shadows. Outdoors, use `sky`.
- **Lens.** Use long lenses (50 to 100) for subjects, wide lenses for scale, and `fstop` for focus.
- **Depth.** Add a foreground, a subject and a background, separated by light or `haze`.
- **Contact.** Objects must sink slightly into what they touch, never float above it.
- **Real structure.** Model what the real thing has, including the parts people forget: the underside,
  gills, joints, seams, thickness and edges. A primitive with a nice material still reads as a primitive.
- **Enough geometry.** Anything the camera gets close to needs smooth curves. Small objects are the
  usual offenders, so keep `sphere` detail at 3 or more wherever a shape is visible.
- **Living motion.** Add `wobble` to cameras and keep things moving slightly, even at rest. Motion
  blur is on by default.

Rules:

- Costs, slowest first: volumes, hair, huge instance counts, many bounces. Use `ctx.low_quality` to
  reduce anything that doesn't change how the review reads.
- The reference scene's roughly 1 million hair strands fit in 6 GB of GPU memory. Beyond that is untested, so
  check a final-quality frame before relying on more.
- Keep the composition legible: subject in frame, background not empty, motion eased, no pop-in
  unless intended.
- Spell text exactly as the prompt does, and only add text if the prompt calls for it.

## 3. Check it with your own eyes

```
node src/blender-video/render.mjs videos/<slug>/scene.py --preview
```

Read `videos/<slug>/preview.png`, a 4x3 contact sheet of evenly spaced, low-sample frames. The command
also prints each sample's brightness, plus warnings for blown-out, dark or unchanging frames. Treat
those warnings as bugs unless the look calls for them, such as a night scene. Critique honestly:

- Does it show what was asked for? Would someone recognize the subject without the prompt?
- Is anything blown out, too dark, cropped, clipped by the camera or hidden?
- Does it look real for its style? Look for flat materials, floating objects and empty backgrounds.
- Is the first shot as strong as the rest? The opening must have a clear subject, a readable background
  and color, because it decides whether anyone keeps watching.
- Does the sheet show real change over time, and does the ending resolve?

Stills hide motion problems. For each fast or important moment, check a dense sheet of that window:

```
node src/blender-video/render.mjs videos/<slug>/scene.py --range 2 3.5
```

Read `videos/<slug>/range.png`. Look for sliding feet, intersecting parts, popping and bad cuts.
Fix what's wrong and check again, up to 3 rounds. If the render reports a scene error, fix it and rerun.

## 4. Check the budget

Render one frame at final quality, from the most demanding shot:

```
node src/blender-video/render.mjs videos/<slug>/scene.py --at <seconds>
```

Read `videos/<slug>/frame-<seconds>.png` and inspect the detail at full size, which is where these show
up: visible facets, one part showing through another, gaps where parts meet, and shapes that look like
primitives. Fix them before the final render, because contact sheets are too small to reveal them. The command prints an estimate for the
whole video, which tends to run high because the first frame includes loading time. If it is over
budget, reduce in this order until it fits: `samples` down to 16, hair and instance counts, volumes,
`bounces`, and finally `engine='EEVEE'`, which is several times faster but loses much of the realism.

## 5. Render and report

```
node src/blender-video/render.mjs videos/<slug>/scene.py --max-minutes 9
```

Run it with a 10-minute tool timeout. Exit code 75 and an `UNFINISHED` line mean it stopped on
purpose with its progress saved, so run the same command again until it prints `Done`. Finished frames
are kept in `videos/<slug>/frames/`, but changing `scene.py` discards them, so don't edit the scene
once the final render has started unless something is wrong.

Finish with the path to `videos/<slug>/video.mp4`, one sentence describing the result, the render
time, and anything you couldn't achieve from the prompt.

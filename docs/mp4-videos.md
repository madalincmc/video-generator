# MP4 videos

Use this when you want a **video file** to post, share or edit: social clips, shorts, or anything you'd upload somewhere. For motion that runs live on your own website, see [Live website animations](live-animations.md).

<table>
  <tr>
    <td align="center" width="62%">
      <img src="media/balloon.gif" alt="A striped hot air balloon drifting over misty mountains as the sun rises" width="480"><br>
      <sub><em>"a hot air balloon drifting over misty mountains at sunrise, 8 seconds"</em></sub>
    </td>
    <td align="center" width="38%">
      <img src="media/paper-boat.gif" alt="A paper boat riding huge waves at night with lightning" width="220"><br>
      <sub><em>"a paper boat sailing through a stormy sea at night, with lightning flashes, vertical format for shorts, 6 seconds"</em></sub>
    </td>
  </tr>
</table>

Neither video was edited by hand after generation. The GIFs are downscaled previews.

## Make a video

```bash
npm run video -- "a lighthouse in the fog, its beam sweeping across dark water"
```

Or open Claude Code in this folder and type:

```text
/video a lighthouse in the fog, its beam sweeping across dark water
```

The result is saved to `videos/<slug>/video.mp4`, where Claude picks the short `<slug>` name.

| | `npm run video` | `/video` in Claude Code |
|---|---|---|
| **Best for** | One-shot generation | Refining a video over several messages |
| **Follow-up changes** | Run it again with a new prompt | Just ask, in the same session |
| **Permissions** | Pre-approved: edit `videos/` and `heroes/`, run the two build scripts | Follows your Claude Code permission settings |
| **Billing** | Always your Claude Code login, because it removes `ANTHROPIC_API_KEY` | Your session's login, which may be an API key ([details](costs.md#if-you-use-an-api-key)) |

## What the `/video` skill does

A skill is a set of written instructions that Claude Code follows when you call it. This one lives in [`.claude/skills/video/SKILL.md`](../.claude/skills/video/SKILL.md). Claude does the creative work, and `src/video/render.mjs` does the rendering.

1. **Plans.** Chooses the format and writes 2 to 4 timed beats, such as `0-2s reveal, 2-6s orbit, 6-8s title`, plus a palette, lighting and camera style.
2. **Writes the scene.** Creates `videos/<slug>/scene.js`: three.js code for geometry, shaders, procedural textures and any text. No images or footage are downloaded.
3. **Checks its own work.** Renders 12 evenly spaced frames into `preview.png` and looks at the sheet: Is the subject recognizable? Is anything cropped, blown out or too dark? Does it change over time and reach an ending? It fixes what's wrong, for up to 3 rounds.
4. **Renders.** Headless Chrome draws every frame on your GPU, and ffmpeg encodes the MP4.
5. **Reports.** Gives you the file path, a one-sentence description, and anything it couldn't achieve from your prompt.

## Writing a good prompt

| Include | Example | If you leave it out |
|---|---|---|
| **Subject and setting** | "a paper boat in a stormy sea at night" | Required |
| **Length** | "6 seconds" | 8 seconds, and kept under 15 |
| **Format** | "vertical", "shorts", "reels" or "TikTok" | 1920x1080 landscape, at 30 fps |
| **Style and colors** | "low-poly, warm sunset colors" | Claude chooses |
| **Exact on-screen text** | `the title "NEW WORLDS"` | No text unless the prompt calls for it |

## Change a video without using Claude

Every video is plain code, so you can edit `scene.js` yourself and re-render it. These commands **don't use Claude or any tokens**:

```bash
npm run render -- videos/<slug>/scene.js              # full video, saved as video.mp4
npm run render -- videos/<slug>/scene.js --preview    # 12-frame sheet, saved as preview.png
npm run render -- videos/<slug>/scene.js --at 2.5     # one full-size frame at 2.5 seconds
```

Renders are reproducible: the same scene and seed produce the same frames. Two renders of [`videos/example-planet`](../videos/example-planet/scene.js), the hand-written reference scene, came out byte-identical. A render also fails if a scene tries to load anything from outside your machine.

## Speed and cost

On a laptop with an RTX 4050, an 8-second 1080p clip renders in about 10 seconds. The full run takes longer, 7 to 8 minutes in our measurements, because almost all of that time is Claude writing and refining the scene. Generating draws on your Claude Code usage, at no additional cost. See [What it costs](costs.md).

## Limitations

- **Stylized, not photorealistic.** Everything is procedural 3D, so real people or live footage become an interpretation.
- **No sound.** Videos are silent.
- **Reviewed by stills.** Claude checks sampled frames rather than playback, so watch the motion yourself.
- **Memory.** ffmpeg reached about 1 GB during a 1080p render, which can be tight on a 16 GB machine running other work.

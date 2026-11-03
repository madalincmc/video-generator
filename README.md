<div align="center">

# 🎬 Video Generator

### Type a prompt. Get a video or a live website animation. Every pixel is written as code.

**No image models. No video models. No API keys. No stock assets.**<br>
Claude Code writes a three.js scene from your prompt. Your GPU renders it to MP4, or it runs live on your website.

![three.js](https://img.shields.io/badge/three.js-0.187-black?logo=threedotjs)
![Node](https://img.shields.io/badge/Node-22-5FA04E?logo=nodedotjs&logoColor=white)
![Claude Code](https://img.shields.io/badge/AI-Claude%20Code%20only-D97757?logo=anthropic&logoColor=white)
![Runs locally](https://img.shields.io/badge/renders-100%25%20local-2ea44f)

<br>

<img src="docs/balloon.gif" alt="A striped hot air balloon drifting over misty mountains as the sun rises" width="640">

*"a hot air balloon drifting over misty mountains at sunrise, 8 seconds"*

</div>

## ✨ Gallery

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/paper-boat.gif" alt="A paper boat riding huge waves at night with lightning" width="270"><br>
      <sub><em>"a paper boat sailing through a stormy sea at night, with lightning flashes, vertical format for shorts, 6 seconds"</em></sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/planet.gif" alt="A low-poly planet with orbiting moons and the title NEW WORLDS" width="400"><br>
      <sub><em>Hand-written reference scene that the generator learns the format from</em></sub>
    </td>
  </tr>
</table>

The prompted videos above came straight from the pipeline, with no manual edits. Their source is in [`videos/`](videos/). The GIFs are downscaled previews of the full-quality MP4s.

## 🚀 Quick start

**You need:** Node 22, Chrome or Edge, and [Claude Code](https://claude.com/claude-code) signed in.

```bash
npm install
npm run generate -- "a lighthouse in the fog, its beam sweeping across dark water"
```

Your video lands in `videos/<slug>/video.mp4`.

Prefer to work interactively? Open Claude Code in this folder and run `/video <prompt>`, then keep asking for changes.

## 🌊 Live animations for websites

Want motion on a web page rather than an MP4? `/hero` writes a live three.js scene and bundles it, three.js included, into one file that runs on your visitors' GPUs.

<div align="center">
  <img src="docs/hero-live.png" alt="A wave of violet, pink and cyan dots behind the header of a live portfolio site" width="720"><br>
  <sub><em>Running in production on <a href="https://cotetiu-madalin-portfolio.vercel.app/">cotetiu-madalin-portfolio.vercel.app</a>, in the header of every page</em></sub>
</div>

```bash
npm run hero -- "a flowing wave of small dots, in violet and cyan"
node src/hero.mjs heroes/<slug>/scene.js --out ../my-site/public/hero
```

```js
const { mount } = await import('/hero/hero.js');
const hero = mount(element, { theme: 'dark' }); // then hero.setTheme('light'), hero.destroy()
```

It's transparent, follows the cursor if the scene uses it, and supports light and dark themes. It resizes with the page, pauses off-screen, shows a still frame for reduced-motion visitors, lowers its resolution on slow devices, and does nothing if WebGL is unavailable.

The page element needs a position set, because the canvas fills it absolutely.

Every build has to pass these checks on the integrated GPU, under a strict Content Security Policy:

| Check | Budget | `dot-ocean` |
|---|---|---|
| Median frame at 1920x1080 | 12 ms | 1.3 ms |
| 95th percentile frame | 20 ms | 3.4 ms |
| Gzipped bundle | 250 KB | 134 KB |
| Opaque pixels | 50% | 0% |
| Still looks the same after an hour | Required | Yes |

**Fitting it to a site:** a scene can't know where a given page puts its text, so a site with more than one layout may need its own masking. The portfolio uses a CSS mask to keep the wave clear of each page's text column and fade it out before the header ends.

## 🧠 How it works

```mermaid
flowchart LR
    A["💬 Your prompt"] --> B["🤖 Claude Code<br/>writes a three.js scene"]
    B --> C["🖼️ Renders a<br/>contact sheet"]
    C --> D{"👀 Looks right?"}
    D -- "no, up to 3 rounds" --> B
    D -- yes --> E["🌐 Headless Chrome<br/>draws every frame on your GPU"]
    E --> F["🎞️ ffmpeg<br/>encodes the frames"]
    F --> G["✅ video.mp4"]
```

The interesting step is the loop. Claude **looks at its own output**, critiques it and fixes the code before committing to a final render. `/hero` uses the same loop, with a bundling step and budget checks in place of the final render.

## 🔒 Built-in guarantees

| | |
|---|---|
| **Reproducible** | Scenes run on a virtual clock with seeded randomness. Two renders of the example scene were byte-identical. |
| **Local rendering** | Any scene that requests something outside the local server fails the render. |
| **Billed to your plan** | `generate` removes `ANTHROPIC_API_KEY` from its environment, so runs use your Claude Code login rather than per-token API billing. |
| **Scoped permissions** | The CLI lets Claude edit only `videos/` and `heroes/`, and run only the two build scripts. |

## 🛠️ Commands

| Command | What you get |
|---|---|
| `npm run generate -- "prompt"` | The full pipeline, from prompt to MP4 |
| `npm run hero -- "prompt"` | The full pipeline, from prompt to live `hero.js` |
| `node src/render.mjs videos/<slug>/scene.js` | Full render to `video.mp4` |
| `node src/render.mjs videos/<slug>/scene.js --preview` | 12-frame contact sheet at `preview.png` |
| `node src/render.mjs videos/<slug>/scene.js --at 2.5` | One full-resolution frame |
| `node src/hero.mjs heroes/<slug>/scene.js` | Build and check a hero, with a contact sheet at `preview.png` |
| `node src/hero.mjs heroes/<slug>/scene.js --out <dir>` | The same, then copy `hero.js` to your site if it passes |

## 📊 What a generation costs

There are no per-generation charges, but it does use your Claude Code plan. Measured on a Windows laptop with an RTX 4050 and Opus 5.5:

| Output | Format | Tokens | Time |
|---|---|---|---|
| Paper boat | 6s video, vertical | 1.56M | ~8 min |
| Hot air balloon | 8s video, 1080p | 1.42M | ~7 min |
| Dot ocean | Live hero | 0.94M | ~3 min |

- About 90% of those tokens are low-cost cache reads.
- The balloon run used **10–13% of a session limit** and about **1% of a weekly limit**. That's an estimate from one run, and it will vary by plan and prompt.
- Almost all the time goes to writing and refining the scene. The final render takes seconds.

## 📁 Project layout

```text
.claude/skills/video/SKILL.md   The prompt-to-video workflow and scene contract
.claude/skills/hero/SKILL.md    The prompt-to-live-animation workflow and scene contract
src/generate.mjs                CLI that runs a skill through `claude -p`
src/render.mjs                  Captures frames in headless Chrome and encodes with ffmpeg
src/hero.mjs                    Bundles a hero with esbuild and enforces its budgets
src/browser.mjs                 Local server and locked-down browser, shared by both
src/runtime/                    Browser side: frame loop, virtual clock, helpers, hero runtime
videos/<slug>/scene.js          Generated videos (rendered files stay out of git)
heroes/<slug>/scene.js          Generated heroes (builds and previews stay out of git)
```

## 🚧 Current limitations

- **Stylized, not photorealistic.** Everything is procedural 3D, so real people and live-action footage become an interpretation.
- **Silent.** There's no audio yet.
- **Checked by stills.** Claude reviews sampled frames, not playback, so motion is worth checking yourself.
- **Memory hungry.** ffmpeg reached about 1 GB during a 1080p render, which can be tight on a 16 GB machine with other work running.
- **Cancelling isn't clean yet.** Killing the outer command may leave a generation running in the background.
- **Tested on Windows only.** The renderer looks for browsers on macOS and Linux too, but that's untested.
- **Heroes aren't measured on phones.** Budgets run on a laptop's integrated GPU, so real phone performance is unknown.
- **A stopped run still exits 0.** If Claude halts part-way, `npm run generate` and `npm run hero` still report success, so read the final message.

## 🗺️ Ideas for later

- [ ] Procedural audio synced to the picture
- [ ] Clean cancellation and lower memory use
- [ ] Masking and placement options built into `/hero`
- [ ] A local web page for entering prompts
- [ ] Reusable style presets

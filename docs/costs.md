# What it costs

**No additional cost.** If you have Claude Code, you already have everything you need. There's no extra AI service, image or video model, API key, or per-video charge. Generating simply draws on the usage your plan already includes.

This is the main strength of the architecture. Claude Code is the only AI involved, because it writes each scene as code and your own machine does the rendering. Every run measured here used a **basic Claude Code subscription**, with nothing else paid for.

## What you pay for

| Activity | Uses your Claude usage? | Additional cost |
|---|---|---|
| Generating a new video or animation | **Yes** | **$0** |
| Asking Claude to change one | **Yes** | **$0** |
| Re-rendering a scene with `npm run render` | No | $0 |
| Rebuilding an animation with `npm run hero:build` | No | $0 |
| Editing `scene.js` by hand | No | $0 |
| Visitors viewing a live animation on your site | No | $0 for AI. Your host serves a 134 KB gzipped file (for `dot-ocean`) |
| three.js, Puppeteer, ffmpeg, esbuild | No | $0, free npm packages |
| Image or video AI models, stock assets | Not used | $0 |

**What you need:** [Claude Code](https://claude.com/claude-code), signed in with your subscription. Everything except Claude runs on your own machine, while Claude itself runs in Anthropic's cloud, not locally.

## How much of your usage it takes

We ran `/usage` before and after generating the balloon video on the basic subscription:

| Limit | Before | After | Change |
|---|---|---|---|
| Current session | 26% | 40% | +14 points |
| Current week, all models | 4% | 5% | +1 point |

- That window also included about 534K tokens from the Claude session running the test, so we estimate the video itself at **10 to 13%** of a session limit.
- That suggests **roughly 7 to 10 similar videos** in one session window, if you use Claude for nothing else.
- `/usage` shows whole percentages, so the weekly figure is rough. It's also a single run, so expect yours to vary by prompt and plan.

To see your own numbers, run `/usage` in Claude Code before and after a generation.

**If you reach a limit,** your usage is used up until it resets, as with anything else you do in Claude Code. The time and percentage shown by `/usage` tell you when. This project never buys more usage on your behalf, though it's worth checking your account settings if you've turned on any paid extra usage.

## Measured runs

Each row is one real run from a saved transcript, using Claude Opus 5.5 at Claude Code's default settings.

| Run | Type | Time | Model calls | Output | Cache writes | Cache reads | Total tokens |
|---|---|---|---|---|---|---|---:|
| Paper boat, 6s vertical | MP4 | 8.3 min | 17 | 50,953 | 102,713 | 1,411,036 | **1.56M** |
| Hot air balloon, 8s 1080p | MP4 | 7.0 min | 17 | 36,518 | 87,939 | 1,293,413 | **1.42M** |
| Dot ocean | Live | 3.5 min | 14 | 16,796 | 60,890 | 859,525 | **0.94M** |

Uncached input was under 40 tokens per run, so it's left out.

Three runs aren't an average. The dot ocean figures also include a restart after a permissions problem that has since been fixed.

**Why the totals look so high:** about 90% of each total is cache reads. Every model call re-reads the conversation so far, and cached context counts for far less than new work, so the token total overstates how much work a run really was.

## If you use an API key

Everything above assumes you're signed in with a subscription. API billing is different, because you then pay per token. It's worth checking which one you're using:

- **`npm run video` and `npm run hero`** remove `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` before starting Claude Code, to keep runs on your subscription login.
- **`/video` and `/hero` inside Claude Code** use whatever your session is signed in with. `/usage` tells you if that's your subscription.

For comparison only, here's what the same runs would cost if billed through the API. **This isn't what we paid: on the subscription, these runs cost nothing extra.**

| Run | API-billing equivalent |
|---|---:|
| Paper boat | $2.12 |
| Hot air balloon | $1.69 |
| Dot ocean | $1.00 |

Based on Opus 5.5 rates per million tokens when this was written: $4 input, $20 output, $8 for 1-hour cache writes and $0.20 for cache reads. See [current API prices](https://platform.claude.com/docs/en/about-claude/pricing).

## How to make your usage go further

1. **Make small changes yourself.** Editing `scene.js` and re-rendering uses no Claude usage, and each change you ask Claude for re-reads the whole conversation.
2. **Group your feedback.** One message listing three fixes uses less than three separate messages.
3. **Start simple.** The dot wave used about a third fewer tokens than the videos, with far less scene code (175 lines, against 627 and 890).
4. **Try a lighter model.** Use `/model` in Claude Code before running `/video` or `/hero`. We haven't measured its quality or usage on this project.

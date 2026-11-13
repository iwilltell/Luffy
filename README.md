# 麦わらのルフィ · Straw Hat Luffy

A single-screen React (Vite) page. Chibi Luffy bobs in a little wooden boat on the sea. He watches
your cursor, blushes if you linger on him, laughs when you click, and chases his hat when a sea
breeze blows it off. The scene is a moonlit night by default, with a sunny day mode.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/ (relative paths, works on any GitHub Pages sub-path)
```

## What you can do

| Action | Result |
| --- | --- |
| Move the cursor | The boat sails after it, easing in and out and rocking into the turn, with a foam wake. His head also turns through 5 drawn steps each way to look at the cursor |
| Click his hat | The wind takes his hat (same sequence as the gust below) |
| Hover on him ~1 s | He blushes (照れ…) |
| Click him / `L` | Laugh (シシシッ!). Clicking during a laugh keeps him laughing |
| Fast swipe across him / `G` | A gust (ビュオォ!) blows his hat off. He stretches his arm out (ゴムゴムの〜!), catches it and puts it back on: **ドン!!** with manga focus lines, screen shake and a burst of coins |
| Click the meat / `F` | He eats it (ニク!!). It comes back after 7 s |
| Click the sea | Splash ring and droplets |
| Click the sky | Sparkles, plus a shooting star at night |
| `T` / ☀☾ | Smooth night ↔ day transition |
| `M` / 🔈 | Generated WebAudio: waves, laughs, wind, rubber boing, DON thump. Off by default |
| Leave it alone 40 s | A sea breeze comes along by itself |

The **wanted poster** shows a sepia portrait taken from the live sprite. Every reaction raises his
bounty with a rolling counter. The bounty is saved in `localStorage` (↺ resets it).

## Compared with the Pikachu reference

* Pikachu has 3 look poses with a blink to hide the switch. Luffy has 9 head-turn drawings with
  hysteresis and a short cross-dissolve, so he tracks the cursor continuously.
* Pikachu has one reaction (a giggle). Luffy has 4 (blush, laugh, feed, the full hat-chase gust).
* Instead of a flat backdrop there is a full scene: sky gradient, twinkling stars, shooting stars,
  moon/sun, parallax clouds, gulls, an animated ocean with a light path on the water, and a boat
  that rides the swell. It also has a flickering lantern and a meat-on-the-bone prop.
* The cursor leaves foam bubbles over the water and sparkles in the sky. Effects include manga
  sound-effect pops, wind streaks, focus lines and coin bursts.
* Synthesised sound, a bounty mini-game, keyboard shortcuts, and both portrait and landscape layouts.

## Frames

The 70 Gemini frames (1280×720 on a black plate) go through `tools/build_frames.py`:

* The black plate is flood-filled away from the edges. His hair is about 9–11 in brightness and
  the plate is 0–2, so the hair survives. A 2 px ink line is kept around him.
* The generator's ✦ watermark is removed. Frame edges where the flying hat or wind leaves the
  shot are feathered.
* Frames 63–69 are a zoomed-out shot. They are rescaled by matching the straw-hat brim width
  (×1.27) so the ending lines up with the idle pose.
* Each frame is trimmed and shelf-packed into `public/frames/luffy-base.webp` (idle, turns, blink,
  blush, laugh) and `luffy-gust.webp` (the hat chase, loaded lazily). Half-resolution copies are
  used on small or low-DPR screens. `luffy.json` holds each frame's atlas rect and its placement
  in plate space.

```bash
# needs Python with pillow, numpy, scipy; expects the zip extracted into _src/
npm run frames
```

| Frames | Use |
| --- | --- |
| 12 | front |
| 3 4 5 6 | head turning toward screen-right |
| 23 22 17 19 | head turning toward screen-left |
| 15 16 | blink |
| 26–28 | blush |
| 29–38 | laugh (31–38 loop) |
| 39–62 | wind → hat off → arm stretch → catch |
| 63 | DON! (hat back on) |
| 64–69 | grin |

`prefers-reduced-motion` freezes the ambient motion (bobbing, drifting, twinkling, cursor trail,
shake, focus lines). Reactions still play when you trigger them.

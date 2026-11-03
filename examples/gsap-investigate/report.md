# Investigation: what fonts, colours and animation tech does the homepage use, with proof

https://gsap.com/ · run 20261103-143248-gsap-com-eddc7d0a · finished 2026-11-03 14:33 UTC

Every line below cites evidence [E#] from DEA's own runs (see the index at the end). ✔ Verified = seen directly · ≈ Inferred = strong signal · ? Unknown = could not tell.

## What DEA found

- ✔ The page title is "Homepage | GSAP". [E1]
- ✔ GSAP 3.15.0 (animation) [E2]
- ✔ GSAP ScrollTrigger 3.15.0 (animation) [E3]
- ✔ Cloudflare (hosting) [E4]
- ✔ Google Analytics / Tag Manager (analytics) [E5]
- ✔ Loaded font faces: Mori. [E6]
- ✔ Text is set mostly in Mori (drawn with PP Mori), 100% of characters. [E7][E8]
- ✔ Dark scheme: background #0e100f (near-black), text #fffce1 (lime-tinted off-white), accents #fec5fb pale magenta, #ff8709 orange, #0ae448 vivid light green; text contrast 18.43:1. [E9]
- ✔ On screen (including canvas/WebGL), the main colours are #0b0f0e near-black 92%, #fefce2 lime-tinted off-white 3%, #09e348 vivid light green 1%, #adfe85 pale green 1%. [E10]
- ✔ CSS motion: 9 animations/transitions ran while DEA watched, mostly 700ms, 300ms, 800ms; easing custom ease-out (fast start, long soft landing), custom ease-in-out, ease-out. [E11][E12]
- ✔ GSAP 3.15.0 animates 273 elements (scaleX, scaleY, xPercent, rotation, yPercent); eases power2.out, power1.out (GSAP default), none; 44 ScrollTriggers, 1 pinned sections. [E13][E14]
- ≈ 1 visible elements keep changing transform/inline style every frame without any CSS animation: motion driven from JavaScript. [E15] — style changed between animation frames while no CSS animation or transition was running on it

## Gap → path to result

What DEA could not fully decode yet, what it knows anyway, its best reconstruction (Inferred), and the next probe that would close the gap.

### G1. 1 recorded motion(s) did not fit a simple curve

**Known**

- Verified: div.home-hero__flair.home-hero__flair--windmill rotate changes (irregular (mean 83.134, spread 17.596): noise or several overlapping drivers)

**Missing:** the formula: noise, physics, or several drivers added together

**Best reconstruction now (Inferred):** treat them as noise around the mean; the shader decode shows the formula when the value feeds a shader

**Next probe**

- `dea motion https://gsap.com/ --idle 8 --scroll 12`: longer recording separates slow drivers from noise


## How DEA worked it out

Plan by DEA’s rules (no language model): "tech" → what it is built with; "fonts" → how it looks and moves; "animation" → how it moves (timelines, scroll, eases).

| step | what | status | run | result |
|---|---|---|---|---|
| s1-stack | Detect the stack: frameworks, libraries, versions, hosting, with proof for each. | done | 20261103-143248-gsap-com-4cf5de39 | GSAP 3.15.0, GSAP ScrollTrigger 3.15.0, Cloudflare, Google Analytics / Tag Manager |
| s2-design | Decode the design: fonts actually rendered, colours, type scale, motion and easing, WebGL scenes and shaders. | done | 20261103-143259-gsap-com-8336400b | Design decode: https://gsap.com/ · Fonts: Mori 400/600 (self-hosted, 100%) · Type sizes: 14 / 16 / 17 / 18 / 19 / 20 / 21 / 23 / 24 / 32 / 33 / 34 / 40 / 44 / 6 |
| s3-motion | Decode the motion: GSAP timeline tree and ScrollTriggers, CSS/WAAPI animations, Lottie/Rive/three.js clips, and a frame recording fitted to eases. | done | 20261103-143326-gsap-com-214f0d2c | Homepage / GSAP · GSAP 3.15.0: 273 timelines/tweens, 44 ScrollTriggers · CSS: 0 running animations, 0 @keyframes, 11 transition styles · Recorded 584 frames (9. |

Go deeper:
- Design decode: `dea report 20261103-143259-gsap-com-8336400b --design`

## Evidence index

| id | run | file | what | excerpt |
|---|---|---|---|---|
| E1 | 20261103-143248-gsap-com-4cf5de39 | run.json | dom: document.title |  |
| E2 | 20261103-143248-gsap-com-4cf5de39 | run.json | global: window.gsap.version | 3.15.0 |
| E3 | 20261103-143248-gsap-com-4cf5de39 | run.json | global: window.ScrollTrigger | 3.15.0 |
| E4 | 20261103-143248-gsap-com-4cf5de39 | run.json | header: server / cf-ray | cloudflare |
| E5 | 20261103-143248-gsap-com-4cf5de39 | run.json | har: https://www.googletagmanager.com/gtag/js?id=G-XWSY51WBF0 |  |
| E6 | 20261103-143248-gsap-com-4cf5de39 | run.json | dom: document.fonts | 4 faces |
| E7 | 20261103-143259-gsap-com-8336400b | design.md | cdp: CSS.getPlatformFontsForNode | PP Mori (web font) |
| E8 | 20261103-143259-gsap-com-8336400b | design.md | computed-style: p.visually-hidden |  |
| E9 | 20261103-143259-gsap-com-8336400b | design.md | computed-style: color / background-color, weighted by text length and area |  |
| E10 | 20261103-143259-gsap-com-8336400b | design.md | screenshot: 11 frames in frames/ | pixel colours grouped in OKLab |
| E11 | 20261103-143259-gsap-com-8336400b | design.md | cdp: Animation.animationStarted | 9 events |
| E12 | 20261103-143259-gsap-com-8336400b | design.md | stylesheet: transition / animation declarations | 11 durations declared |
| E13 | 20261103-143259-gsap-com-8336400b | design.md | dom: element._gsap (GSAP’s own cache on animated elements) | 273 elements |
| E14 | 20261103-143259-gsap-com-8336400b | design.md | global: gsap.globalTimeline.getChildren() | 60 tweens |
| E15 | 20261103-143259-gsap-com-8336400b | design.md | sampling: div.home-hero__flair.home-hero__flair--windmill | 14 changes in 1212ms |

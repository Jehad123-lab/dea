# The 60-second demo

One take, screen-recorded at 1080p. Inter in the terminal theme, dark background, no browser extensions visible.
Pick a public WebGL site you are allowed to show; examples below use threejs.org because it is built for that.

| Time | On screen | Command / action | Say (or caption) |
| --- | --- | --- | --- |
| 0:00 to 0:05 | The site running | open `https://threejs.org/examples/webgl_animation_keyframes.html` | "Any WebGL site." |
| 0:05 to 0:15 | Terminal | `npx dea-cli stack <url>` | "What it is built with, each fact Verified or Inferred, with proof." |
| 0:15 to 0:30 | Terminal, then report.md | `npx dea-cli extract <url> --own-assets` | "It records the frames and rebuilds them as editable three.js." |
| 0:30 to 0:40 | preview/ side by side | open `preview/original.png` and `preview/rebuild.png` | "Left: the site. Right: the rebuild. Scored, not guessed." |
| 0:40 to 0:50 | Framer | `npx dea-cli framer latest --name Hero`, paste into Framer, set Source | "One command to a Framer component, with controls." |
| 0:50 to 0:57 | Framer Preview | drag a colour control, move the pointer | "Change the shader live." |
| 0:57 to 1:00 | Title card | `npx dea-mcp` / github.com/Jehad123-lab/dea | "DEA. Decode the web, with evidence." |

Rules for the recording:
- Record with `--own-assets` so nothing of the site's own files appears in what you ship.
- Cut the waiting: keep each command's start and its result, trim the progress lines.
- Show the evidence labels once on screen; they are the point.
- Do not claim "Awwwards-level" or any score you did not get in that take.

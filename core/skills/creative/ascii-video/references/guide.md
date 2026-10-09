# ASCII Video Guide

Referenced from `SKILL.md`.

## Creative Direction

### Aesthetic Dimensions

| Dimension | Options | Reference |
|-----------|---------|-----------|
| **Character palette** | Density ramps, block elements, symbols, scripts (katakana, Greek, runes, braille), project-specific | `architecture.md` § Palettes |
| **Color strategy** | HSV, OKLAB/OKLCH, discrete RGB palettes, auto-generated harmony, monochrome, temperature | `architecture.md` § Color System |
| **Background texture** | Sine fields, fBM noise, domain warp, voronoi, reaction-diffusion, cellular automata, video | `effects.md` |
| **Primary effects** | Rings, spirals, tunnel, vortex, waves, interference, aurora, fire, SDFs, strange attractors | `effects.md` |
| **Particles** | Sparks, snow, rain, bubbles, runes, orbits, flocking boids, flow-field followers, trails | `effects.md` § Particles |
| **Shader mood** | Retro CRT, clean modern, glitch art, cinematic, dreamy, industrial, psychedelic | `shaders.md` |
| **Grid density** | xs(8px) through xxl(40px), mixed per layer | `architecture.md` § Grid System |
| **Coordinate space** | Cartesian, polar, tiled, rotated, fisheye, Möbius, domain-warped | `effects.md` § Transforms |
| **Feedback** | Zoom tunnel, rainbow trails, ghostly echo, rotating mandala, color evolution | `composition.md` § Feedback |
| **Masking** | Circle, ring, gradient, text stencil, animated iris/wipe/dissolve | `composition.md` § Masking |
| **Transitions** | Crossfade, wipe, dissolve, glitch cut, iris, mask-based reveal | `shaders.md` § Transitions |

### Per-Section Variation

Never use the same config for the entire video. For each section/scene:
- **Different background effect** (or compose 2-3)
- **Different character palette** (match the mood)
- **Different color strategy** (or at minimum a different hue)
- **Vary shader intensity** (more bloom during peaks, more grain during quiet)
- **Different particle types** if particles are active

### Project-Specific Invention

For every project, invent at least one of:
- A custom character palette matching the theme
- A custom background effect (combine/modify existing building blocks)
- A custom color palette (discrete RGB set matching the brand/mood)
- A custom particle character set
- A novel scene transition or visual moment

Don't just pick from the catalog. The catalog is vocabulary — you write the poem.

## Workflow

### Step 1: Creative Vision

Before any code, articulate the creative concept:

- **Mood/atmosphere**: What should the viewer feel? Energetic, meditative, chaotic, elegant, ominous?
- **Visual story**: What happens over the duration? Build tension? Transform? Dissolve?
- **Color world**: Warm/cool? Monochrome? Neon? Earth tones? What's the dominant hue?
- **Character texture**: Dense data? Sparse stars? Organic dots? Geometric blocks?
- **What makes THIS different**: What's the one thing that makes this project unique?
- **Emotional arc**: How do scenes progress? Open with energy, build to climax, resolve?

Map the user's prompt to aesthetic choices. A "chill lo-fi visualizer" demands different everything from a "glitch cyberpunk data stream."

### Step 2: Technical Design

- **Mode** — which of the 6 modes above
- **Resolution** — landscape 1920x1080 (default), portrait 1080x1920, square 1080x1080 @ 24fps
- **Hardware detection** — auto-detect cores/RAM, set quality profile. See `references/optimization.md`
- **Sections** — map timestamps to scene functions, each with its own effect/palette/color/shader config
- **Output format** — MP4 (default), GIF (640x360 @ 15fps), PNG sequence

### Step 3: Build the Script

Single Python file. Components (with references):

1. **Hardware detection + quality profile** — `references/optimization.md`
2. **Input loader** — mode-dependent; `references/inputs.md`
3. **Feature analyzer** — audio FFT, video luminance, or synthetic
4. **Grid + renderer** — multi-density grids with bitmap cache; `references/architecture.md`
5. **Character palettes** — multiple per project; `references/architecture.md` § Palettes
6. **Color system** — HSV + discrete RGB + harmony generation; `references/architecture.md` § Color
7. **Scene functions** — each returns `canvas (uint8 H,W,3)`; `references/scenes.md`
8. **Tonemap** — adaptive brightness normalization; `references/composition.md`
9. **Shader pipeline** — `ShaderChain` + `FeedbackBuffer`; `references/shaders.md`
10. **Scene table + dispatcher** — time → scene function + config; `references/scenes.md`
11. **Parallel encoder** — N-worker clip rendering with ffmpeg pipes
12. **Main** — orchestrate full pipeline

### Step 4: Quality Verification

- **Test frames first**: render single frames at key timestamps before full render
- **Brightness check**: `canvas.mean() > 8` for all ASCII content. If dark, lower gamma
- **Visual coherence**: do all scenes feel like they belong to the same video?
- **Creative vision check**: does the output match the concept from Step 1? If it looks generic, go back

## Critical Implementation Notes

### Brightness — Use `tonemap()`, Not Linear Multipliers

This is the #1 visual issue. ASCII on black is inherently dark. **Never use `canvas * N` multipliers** — they clip highlights. Use adaptive tonemap:

```python
def tonemap(canvas, gamma=0.75):
    f = canvas.astype(np.float32)
    lo, hi = np.percentile(f[::4, ::4], [1, 99.5])
    if hi - lo < 10: hi = lo + 10
    f = np.clip((f - lo) / (hi - lo), 0, 1) ** gamma
    return (f * 255).astype(np.uint8)
```

Pipeline: `scene_fn() → tonemap() → FeedbackBuffer → ShaderChain → ffmpeg`

Per-scene gamma: default 0.75, solarize 0.55, posterize 0.50, bright scenes 0.85. Use `screen` blend (not `overlay`) for dark layers.

### Font Cell Height

macOS Pillow: `textbbox()` returns wrong height. Use `font.getmetrics()`: `cell_height = ascent + descent`. See `references/troubleshooting.md`.

### ffmpeg Pipe Deadlock

Never `stderr=subprocess.PIPE` with long-running ffmpeg — buffer fills at 64KB and deadlocks. Redirect to file. See `references/troubleshooting.md`.

### Font Compatibility

Not all Unicode chars render in all fonts. Validate palettes at init — render each char, check for blank output. See `references/troubleshooting.md`.

### Per-Clip Architecture

For segmented videos (quotes, scenes, chapters), render each as a separate clip file for parallel rendering and selective re-rendering. See `references/scenes.md`.


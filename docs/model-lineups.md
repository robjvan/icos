# Models and Lineups

ICOS is **provider-agnostic**. Chat, memory/extraction, and claim
verification all go through an interface (OpenAI-compatible for chat and
memory; `POST /v1/systemone` for a decision-model verifier), so nothing is
hard-wired to a vendor or a machine. That makes the *lineup* a deployment
choice — and the one real constraint is **how many models you keep
resident at once**, because on a laptop they all draw from the same pool
of memory.

## TL;DR

- **Minimize resident models.** One multimodal model can cover several
  roles (memory, slow vision, audio) without adding memory.
- **Keep verification off the GPU** when you can — it fires mid-turn and
  should not queue behind memory or vision.
- **Ideal lineup:** one local multimodal model (Gemma4-E4B) + a cloud chat
  model + a tiny local detector (YOLO) + a local Jev-style verifier on the
  CPU. ~5.6 GB resident.
- **"Qwen-centric" is the heavier option, not the lighter one:** it still
  needs the multimodal model for memory *and audio*, so you end up running
  two resident models.

## The roles

| Role | What it needs | Typical location |
| --- | --- | --- |
| **Memory / extraction** | a small text LLM | local (GPU or CPU) |
| **Chat** | any capable LLM | local or cloud |
| **Vision (slow)** | a multimodal LLM | local |
| **Vision (fast)** | a tiny detector | local (CPU or GPU) |
| **Audio input** | an audio-capable model | local |
| **Claims verifier** | a yes/no *decision* model, or a chat LLM | local (CPU is fine) or cloud |

## What ICOS wires today

| Role | Status | Setting |
| --- | --- | --- |
| Memory / extraction | **wired** | `MEMORY_LLM_*` (falls back to `LLM_*`) |
| Chat | **wired** | `LLM_*` or a provider in the Models tab (`providers.json`) |
| Claims verifier | **wired** (M15.5c) | `HALLUCINATION_DECISION_URL` (decision) or `HALLUCINATION_VERIFIER_PROVIDER` (LLM) |
| Vision / audio | not yet — external sensory reintegration (M18) | — |

ICOS does not *require* any particular model. An empty provider catalog and
the `LLM_*` env values are a complete, working configuration.

## Where a model runs matters

Two pools: the **GPU / unified memory** (Apple silicon shares one pool
between CPU and GPU) and **system RAM**.

- A model loaded for the GPU occupies unified memory for as long as it is
  loaded, whether or not it is answering right now.
- A model run **CPU-only** occupies RAM and leaves the GPU free — useful
  when verification should not compete with the models that serve the
  turn.

**Jev-style is not inherently CPU-bound — you choose the backend:**

| Backend | Runs on | Notes |
| --- | --- | --- |
| MLX | Apple silicon (unified memory) | fastest on a Mac; pulls the model into unified memory |
| PyTorch | CUDA, Apple MPS, or CPU | float32 default; CPU works but is slower |
| GGUF (llama.cpp + the release's scorer) | GPU offload **or** CPU only (`--ngl 0`) | the CPU path keeps it out of the GPU pool |

The *"`_RAM_`"* entries in the lineups below assume the **CPU/GGUF** path.
If you run Jev on MLX it moves into unified memory, and you should count it
against the GPU budget instead.

## Two lineups

Both fit comfortably on a 16 GB machine. The difference is how many models
are **resident**.

### Ideal

| # | Purpose | Model | Memory |
| --- | --- | --- | --- |
| 1 | Memory | Gemma4-E4B | 5.6 GB (resident) |
| 2 | Chat | Cloud LLM | — |
| 3 | Vision (slow) | Gemma4-E4B | present (same model) |
| 4 | Vision (fast) | YOLO (small) | RAM (tiny) |
| 5 | Audio input | Gemma4-E4B | present (same model) |
| 6 | Claims verifier | Local Jev-style | RAM (CPU) or unified (MLX) |

One resident model covers memory, slow vision, and audio; the verifier runs
on the CPU; chat is off-machine. **≈5.6 GB resident**, with headroom for
context.

### Qwen-centric

| # | Purpose | Model | Memory |
| --- | --- | --- | --- |
| 1 | Memory | Gemma4-E4B | 5.6 GB (resident) |
| 2 | Chat | Cloud LLM | — |
| 3 | Vision (slow) | Qwen3.5-4B-VL | 2.5 GB (resident) |
| 4 | Vision (fast) | YOLO (small) | RAM (tiny) |
| 5 | Claims verifier | Qwen3.5-4B-VL | present (same model) |

This **still needs Gemma4 for memory** — and for **audio**, which a
vision-language model does not cover — so both models stay resident:
**≈8.1 GB** before context. It buys "one model for vision and
verification" but adds a resident model and loses audio. Choose it only if
Qwen's vision is specifically better for your streams.

## The claims verifier

Verification is tiered, preferred first (see `docs/security.md` and the
M15.5 plan):

1. **`decision`** — a systemone decision model (`HALLUCINATION_DECISION_URL`):
   local Jev-style, a Jev-compatible cloud server, or any server that
   implements `POST /v1/systemone`. Calibrated probabilities, and it can
   only answer the options it is given.
2. **`llm`** — any OpenAI-compatible model named by provider id
   (`HALLUCINATION_VERIFIER_PROVIDER`), e.g. the already-resident Gemma4.
   Cheaper on memory, but if it is the same model that spoke, the verdict
   is recorded as **self** (self-consistency), never as independent
   verification.
3. **none** — deterministic claim/evidence checks only.

A verifier never auto-resolves: disagreement is recorded, not rewritten.
With no verifier configured, a high-stakes claim the evidence cannot
resolve is flagged `unverifiable_high_stakes` rather than accepted.

Running the local Jev-style server needs a Python sidecar (`jev-style
serve`); the model lives on the shared `~/.icos/models` volume. The end
user runs a compose profile, not `pip`.

## The fast vision path

YOLO is the *fast* detector — the small, always-on pass that answers "is
there something here worth the big model's attention." The version and
size are **swappable**: a current small model (e.g. YOLOv26-small) often
matches an older medium one (e.g. YOLOv11-medium) at a fraction of the
cost, but the right choice depends on your actual stream (what you are
detecting, how far, how fast). Treat the specific version as a tuning knob,
not a fixed dependency — and note the interface (a local detector feeding
M18) matters more than which YOLO generation ships.

## Budget guidance

- On 16 GB, leave **~4–6 GB** for the OS, apps, and the Docker VM.
- Count **every resident model**, not just the one answering: a loaded GPU
  model holds its memory until unloaded.
- Offload verification to the CPU when you can; it is bursty and
  latency-tolerant.
- The lineups above fit; the Qwen-centric one fits *tightly* under load.

## Choosing, quickly

- **Default:** the Ideal lineup. One multimodal local model, cloud chat,
  CPU verifier.
- **You want everything local:** keep the Ideal lineup and move chat to a
  local model if it fits — you lose the cloud model's headroom, so watch
  the resident count.
- **You already run Qwen and its vision is better for your task:** the
  Qwen-centric lineup, accepting the second resident model and no audio.
- **You don't want a sidecar:** skip Jev, set
  `HALLUCINATION_VERIFIER_PROVIDER` to a model you already run, and accept
  that the verdict may be `self`.

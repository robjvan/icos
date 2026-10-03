# Models and Lineups

ICOS is **provider-agnostic**. Chat, memory/extraction, and claim
verification all go through an interface (OpenAI-compatible for chat and
memory; `POST /v1/systemone` for a decision-model verifier), so nothing is
hard-wired to a vendor or a machine. That makes the *lineup* a deployment
choice — and the one real constraint is **how many models you keep
resident at once**, because they all draw from the same memory pool.

## TL;DR

- **Pick your hardware route first** (below) — it decides everything else.
- **The supported floor is an 8 GB GPU**, and the *Ideal* lineup fits it:
  one served model resident, everything else off the GPU.
- **Minimize resident models.** One multimodal model can cover several
  roles (memory, slow vision, audio) without adding memory.
- **Keep verification off the GPU** when you can — it fires mid-turn and
  should not queue behind memory or vision.
- **The "Qwen-centric" lineup is the heavier option, not the lighter one:**
  it needs the multimodal model for memory *and audio*, so you run two
  resident models (~8.1 GB) and it does **not** fit an 8 GB card.

## Hardware routes

Find your machine; the rest of this page explains the pieces.

### 1. Discrete GPU, 8 GB VRAM — the supported baseline

This is the configuration the [USAGE](../USAGE.md) requirement (8 GB VRAM)
describes: **one model served, everything else off the GPU.**

- **Resident on the GPU:** the memory/vision/audio model (Gemma4-E4B,
  ~5.6 GB). It is the *only* model the GPU holds.
- **Off the GPU:** the claims verifier (Jev, CPU via GGUF `--ngl 0`) and
  chat (cloud). On a discrete card, CPU-side Jev uses **system RAM** — real
  VRAM-free headroom, not a shared pool.
- **Fast vision:** YOLO small; it may share the GPU only if the remaining
  VRAM allows, otherwise keep it on CPU.
- **Headroom:** ~5.6 GB of 8 GB leaves ~2.4 GB for the KV cache, the
  vision/audio overhead, and the runtime baseline. Fine at moderate
  context — but **do not add a second resident model**. The Qwen-centric
  lineup does not fit here.
- At this size, prefer **cloud chat** (or a small local chat model) over
  loading a second large model beside the memory model.

### 2. Apple silicon, 16 GB unified memory

Unified memory means the CPU and GPU share **one** pool, so "off the GPU"
is softer than on a discrete card — a CPU process still consumes the same
pool, it just does not contend for GPU *compute*. The Ideal lineup fits
comfortably:

- **Resident:** Gemma4-E4B (~5.6 GB), covering memory / slow vision / audio.
- **Verifier:** Jev on **CPU/GGUF** keeps it out of the GPU working set.
  (MLX is faster but runs on the Metal GPU, so it moves into the same
  working set — choose per your headroom.)
- **Chat:** cloud (frees the pool).
- **Fast vision:** YOLO small.

16 GB is the machine in the two lineups below; ~5.6 GB resident leaves real
room, and the Qwen-centric lineup (~8.1 GB) fits here if you want it.

### 3. CPU-only

Everything runs without a GPU — memory model (Ollama/llama.cpp CPU), Jev
(CPU), YOLO (CPU), cloud chat — but slowly. Use it for development and
small machines, not as the daily driver.

### 4. 16 GB+ GPU

Either lineup fits with room to spare, including a local chat model. At
this point the constraint stops being memory and becomes taste.

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

Two pools on a discrete-GPU machine — **VRAM** and **system RAM** — and one
shared pool on Apple silicon. A model loaded for the GPU occupies its pool
for as long as it is loaded, whether or not it is answering right now. A
model run **CPU-only** occupies RAM and leaves the GPU free.

**Jev-style is not inherently CPU-bound — you choose the backend:**

| Backend | Runs on | Notes |
| --- | --- | --- |
| MLX | Apple silicon (unified memory, Metal GPU) | fastest on a Mac; pulls the model into the GPU working set |
| PyTorch | CUDA, Apple MPS, or CPU | float32 default; CPU works but is slower |
| GGUF (llama.cpp + the release's scorer) | GPU offload **or** CPU only (`--ngl 0`) | the CPU path keeps it off the GPU |

The `_RAM_` entries in the lineups assume the **CPU/GGUF** path. On a
discrete GPU that is truly separate VRAM-free RAM; on Apple silicon it is
the same unified pool.

## The lineups

Both models below; the routes above say which fits your machine.

### Ideal — fits 8 GB

| # | Purpose | Model | Memory |
| --- | --- | --- | --- |
| 1 | Memory | Gemma4-E4B | 5.6 GB (resident) |
| 2 | Chat | Cloud LLM | — |
| 3 | Vision (slow) | Gemma4-E4B | present (same model) |
| 4 | Vision (fast) | YOLO (small) | RAM (tiny) |
| 5 | Audio input | Gemma4-E4B | present (same model) |
| 6 | Claims verifier | Local Jev-style | RAM (CPU) or unified (MLX) |

One resident model covers memory, slow vision, and audio; the verifier runs
on the CPU; chat is off-machine. **≈5.6 GB resident.**

### Qwen-centric — 16 GB+, not 8 GB

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
verification" but adds a resident model and loses audio, and it exceeds an
8 GB card. Choose it only above 8 GB, and only if Qwen's vision is
specifically better for your streams.

## The claims verifier

Verification is tiered, preferred first:

1. **`decision`** — a systemone decision model (`HALLUCINATION_DECISION_URL`):
   local Jev-style, a Jev-compatible cloud server, or any server that
   implements `POST /v1/systemone`. Calibrated probabilities, and it can
   only answer the options it is given.
2. **`llm`** — any OpenAI-compatible model named by provider id
   (`HALLUCINATION_VERIFIER_PROVIDER`), e.g. the already-resident Gemma4.
   Cheaper on memory, but if it is the same model that spoke, the verdict
   is recorded as **self** (self-consistency), never as independent
   verification.
3. **`none`** — deterministic claim/evidence checks only.

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

- On 8 GB, run **one** resident model; keep the verifier on CPU and chat
  in the cloud.
- On 16 GB unified, leave **~4–6 GB** for the OS, apps, and the Docker VM.
- Count **every resident model**, not just the one answering: a loaded GPU
  model holds its memory until unloaded.
- Offload verification to the CPU when you can; it is bursty and
  latency-tolerant.

## Choosing, quickly

- **8 GB GPU (the floor):** the **Ideal** lineup. One resident model,
  cloud chat, CPU verifier, small detector. This is the configuration the
  8 GB VRAM requirement refers to.
- **16 GB unified (Apple):** the Ideal lineup, or Qwen-centric if you want
  it; prefer the GGUF CPU verifier to keep the GPU for the multimodal model.
- **You want everything local:** the Ideal lineup with a local chat model
  if it fits, watching the resident count.
- **You already run Qwen and its vision suits your task:** Qwen-centric on
  16 GB+, accepting the second resident model and no audio.
- **You don't want a sidecar:** skip Jev, set
  `HALLUCINATION_VERIFIER_PROVIDER` to a model you already run, and accept
  that the verdict may be `self`.

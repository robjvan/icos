# Core Provenance & Integrity

> **Cross-cutting hardening plan** (like `security-hardening.md`), not a
> numbered cognition milestone. Schedule it when the core ships to people
> other than Rob; it is independent of the M14–M40 order.
>
> Built directly on **M14b** (file-backed, read-only core with no write
> path and fail-closed boot). This plan adds *provenance*: the core is not
> just read-only, it is *authenticated* and *tamper-evident*.

## Objective

Make the immutable core something a bad actor running their own instance
cannot quietly subvert: the core ships signed by Exile Research, boot
verifies it, and a mismatch is refused. An operator may **add** to the
core but never **contradict** it. The intent is that even a hostile
operator cannot force an ICOS agent to act against the baseline it was
built with.

### Research question

> Can ICOS guarantee that the values it runs on are the values it was
> shipped with — verifiably, at boot and at runtime — while still letting an
> operator extend the evolving persona, without pretending to a guarantee
> that client-side software cannot make?

---

# Threat model (read this first)

Be explicit and honest about what this buys.

**What it does:**
- Refuses to start on a core that is not the artifact Exile Research
  signed (or that has been edited), so tampering is **detected and
  rejected**, not silently accepted.
- Makes a modified core **tamper-evident** at boot and at runtime.
- Keeps the operator's power to **add** bespoke beliefs while forbidding
  edits that **contradict** the core (the M14f rule, extended to a
  separate signed layer).

**What it does not do:**
- It cannot stop someone who controls the host **and the binary** from
  patching the check out. No client-side mechanism can. The realistic
  guarantee is *honest-by-default and tamper-evident*, not *tamper-proof*.
- **Encryption is not the control.** A key bundled with the binary is
  extractable; encryption is deterrence/obfuscation at best. **Signing is
  the integrity mechanism.** This plan treats encryption as optional.
- **The core is the character layer, not the capability layer.** A prompt
  can be argued around. Hard constraints come from what the agent can
  physically do — the tool registry, approvals (M8), and action
  permissions (M17). A core boundary that is not backed by a capability
  limit is a strong bias, not a guarantee.

"Who decides what is right" is deliberately out of scope: the mechanism
binds the product to a *stated* baseline; it does not adjudicate morality.
The baseline itself is a benign, broad one (nonviolent, curious,
helpful, non-judgemental, humane).

---

# Slices

# [ ] CP1 — Signed Core + Boot Verification

- [ ] Envelope format for the shipped core: payload + detached signature +
      signer key id + format version.
- [ ] Sign with **Ed25519**; the verification **public key is embedded in
      the binary**, never read from the core directory or env.
- [ ] Boot verifies the signature (and the payload hash) before parsing;
      failure is **fail-closed** exactly like M14b's missing core.
- [ ] Multiple trusted keys so rotation does not brick shipped instances;
      unknown key id → refuse.
- [ ] Key handling: the private signing key is Exile Research-held and
      offline; documented as never present in the repo or the image.

# [ ] CP2 — Packaging and Precedence

- [ ] The signed core ships **with the artifact** (image / release), not as
      an operator-supplied file that replaces it.
- [ ] Clear load order: signed core first and always; it cannot be
      displaced. `PERSONA_CORE_PATH` (M14b) becomes an **operator overlay**
      path, or is retired, per the packaging decision below.
- [ ] Version/report the core: signer key id, core version, payload hash —
      surfaced in status and boot logs, never the raw key material.

# [ ] CP3 — Operator Layer Is Add-Only

- [ ] An operator may supply an **extension** layer (their own added
      beliefs/relationship material) that is merged **after** the core.
- [ ] The extension can **never contradict** a core entry: the M14f rule
      (`core contradiction → critical, non-applicable`) applies to the
      extension at load and at review.
- [ ] The extension is stored where M14b already put the evolving layer;
      the core remains file/artifact-backed with no write path.

# [ ] CP4 — Capability Backing Audit

- [ ] For every `safety_boundary` and `non_negotiable` entry in the core,
      identify the **capability limit** that makes it hard (tool missing,
      approval required, action permission denied, sandbox).
- [ ] Where no limit exists, record it explicitly as "character-level
      only" so the guarantee is not overstated — and file the capability
      gap against the relevant autonomy milestone (M17/M20).

# [ ] CP5 — Runtime Tamper-Evidence

- [ ] Periodic re-verification of the core payload against the boot
      signature/hash (read-only; no write path introduced).
- [ ] Any change is an audited event (`persona_core_tampered` /
      `persona_core_changed`) with severity distinct from ordinary drift.
- [ ] Degraded-but-running policy: what happens if re-verification fails
      mid-run (refuse new turns? drop to a safe mode? explicit, logged).

# [ ] CP6 — Threat Model, Keys, and Ops Docs

- [ ] A `docs/` page stating the guarantees and non-guarantees above in
      plain language (the client-side limit is stated, not hidden).
- [ ] Signing/rotation runbook for Exile Research.
- [ ] Operator guidance: how to add beliefs without touching the core.

# [ ] CP7 — Verification

- **Negative:** a modified core payload is refused at boot; an unknown
  signer key is refused; a core directory that is writable in deployment
  still cannot change the verified core.
- **Extension:** an operator extension that contradicts the core is
  refused/flagged `critical`; additions merge and are visible.
- **Capability backing:** every core boundary has a mapped limit or an
  explicit "character-only" record.
- **Runtime:** tamper mid-run raises the audit event and follows the
  declared policy.
- **Docs:** the threat-model statement matches observed behavior.

---

# Open decisions

- **Packaging:** bundle the signed core inside the image, or as a
  separately-signed artifact mounted read-only? (Affects CP2 and whether
  `PERSONA_CORE_PATH` survives.)
- **Encryption:** include obfuscation-at-rest, or signing only? (Current
  lean: signing only; encryption adds little beyond deterrence.)
- **Public keys:** one embedded key or a small keyring with key ids?
- **Relationship to M34 (Cognitive Continuity):** the core is part of what
  must survive model/hardware migration; coordinate the "core version"
  notion with M34.

---

# Definition of Done

> A shipped ICOS verifies a vendor-signed core at boot and refuses to run
> otherwise; an operator can extend the persona but cannot contradict the
> core; every core boundary is either backed by a capability limit or
> explicitly recorded as character-level; tampering is detected at boot
> and at runtime; and the guarantees and their limits are documented
> honestly.

Completion requires verified unit, e2e, and live-run evidence (including
the negative tamper cases), plus clean `tsc` and `eslint`.

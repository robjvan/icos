# M17c.4 — Discord tools (`discord` / `discord_admin`): live evidence

> Status: **verified (read/info live; moderation unit-only)** (2026-10-07).
> Slice **M17c.4**. Per-slice evidence; M17c is in progress.

## What was built

Discord server info and moderation, **split** so read actions stay
approval-free:

- **`discord`** (`approval: 'none'`) — `server_info`, `member_info`,
  `channel_list`.
- **`discord_admin`** (`approval: 'required'`) — `timeout_member`,
  `kick_member`; gated through the generic native approval path.
- **`DISCORD_ADMIN` port** (`channels/discord-admin.port.ts`); the
  `DiscordAdapter` implements it (guild/member lookup, timeout, kick) behind a
  structural discord.js slice, so the tools layer never imports discord.js.
  Wired via `ChannelsCoreModule` (`useExisting: DiscordAdapter`).
- Registry: strict validators (`member_info` requires `user_id`;
  `timeout_member` requires `duration_ms` 1s–28d; `kick_member` takes an
  optional reason).

### Permissions & safety

`discord_admin` requires the bot to hold the relevant guild permissions
(Moderate Members / Kick Members). The tool is always approval-gated. **No
destructive live test was run** — it would act on real members.

## Unit

| Area | Spec |
| --- | --- |
| Adapter `run`: server/member info, timeout, kick | `channels/discord.adapter.spec.ts` |
| Validators (discord; discord_admin) | `tool-registry.spec.ts` |
| Execution: info (free) + moderation (approval → run) | `tool-execution.service.spec.ts` |
| Offered-tool surface (22) | `conversation.service.spec.ts`, `test/app.e2e-spec.ts` |

Totals at capture: **1162 unit passed, 1 skipped** and **66 e2e passed**;
`tsc`/`eslint` clean. Native tool surface: **22 tools**.

## Live

Container rebuilt, healthy.

```
discord {action: server_info} → {name: "Exile Holdings", memberCount: 3, channelCount: 19}

discord {action: channel_list} → General, the-boardroom, daily-research,
  heartbeat-work-session, learning-pulse, curiosity-pulse, daily-checklist-briefing,
  isabel-blog-post, recall-test-battery, daily-backup,
  persistent-memory-recall-audit, unprompted, … (19 total)
```

Both read actions returned the real server state. `member_info` and the
approval-gated `discord_admin` actions are covered by unit tests; their live run
is deferred (member lookup needs a member id; moderation would affect real
users).

## Note

One tool call per step. The `discord` read tool is the safe half of the pair;
`discord_admin` is the destructive half and stays behind approval.

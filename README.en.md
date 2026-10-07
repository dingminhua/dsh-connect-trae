<p align="center">
  <img src="docs/assets/dsh-connect-trae-usage-card.png" width="860" alt="dsh-connect-trae settings panel" />
</p>

<h1 align="center">dsh-connect-trae</h1>

<p align="center"><b>Connect locally signed-in Trae models to DeepSeek Harness with local DSH tools, a credits overview, and daily check-in claiming.</b></p>

<p align="center">
  <a href="README.md">中文</a> ·
  <a href="#install">Install</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#model-coverage">Model coverage</a> ·
  <a href="CHANGELOG.md">Changelog</a> ·
  <a href="https://github.com/dingminhua/dsh-connect-trae/issues">Issues</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dsh-connect-trae"><img src="https://img.shields.io/npm/v/dsh-connect-trae?style=flat-square&label=npm&color=cb3837" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/dsh-connect-trae"><img src="https://img.shields.io/npm/d18m/dsh-connect-trae?style=flat-square&label=downloads&color=cb3837" alt="npm downloads"></a>
  <a href="https://github.com/dingminhua/dsh-connect-trae/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/dingminhua/dsh-connect-trae/ci.yml?branch=main&style=flat-square&label=tests" alt="test status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/dingminhua/dsh-connect-trae?style=flat-square" alt="MIT license"></a>
  <a href="https://github.com/dingminhua/dsh-connect-trae/stargazers"><img src="https://img.shields.io/github/stars/dingminhua/dsh-connect-trae?style=flat-square" alt="GitHub stars"></a>
  <a href="https://dshfind.com/plugins/dingminhua/dsh-connect-trae"><img src="https://dshfind.com/api/badge/dingminhua/dsh-connect-trae" alt="dshfind plugin"></a>
</p>

A [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) bundle plugin that connects locally signed-in Trae models (**both CN and international installs**) to the DSH model picker. Trae generates structured tool calls while DSH executes its own local tools, with a usage overview (Work/general credits on CN, subscription status on international), daily check-in claiming, and a model-management panel. **The CN and international sides are two parallel providers (`trae` / `trae-global`) that can be used at the same time**; the settings card separates them with tabs for convenient management.

**Runs on macOS, Windows, and Linux**: CI runs the full typecheck / test / build matrix on `ubuntu-latest` and `windows-latest`, and Windows gets purpose-built handling for directory probing, app version headers, and lock behavior — see [Windows notes](#windows-notes).

> Apart from the daily check-in claim, every query this plugin makes is read-only and consumes nothing; the claim only happens when you click the button.

## Features

- **Dual parallel providers** — the CN side registers as the `trae` provider (e.g. `DeepSeek-V4-Flash`, `DeepSeek-V4-Pro`), the international side as `trae-global` (the Gemini/GPT/MiniMax roster), and **both rosters appear in the DSH model picker simultaneously**: different sessions can each pick a side without interfering.
- **Either side can be switched off** — each tab carries its own checkbox (both checked by default): unchecking **withdraws that provider from the DSH model picker entirely** (not merely hiding the tab) and stops all of its requests; checking it again restores it with the account, directory, picks, and context budgets intact. If you never use the international side, just uncheck it.
- **Tabbed settings card** — the card's top carries a "Domestic / Global" tab bar; each tab holds its own account picker, usage overview, and model management. Account, directory, selection, and unsaved drafts are fully isolated per tab — switching accounts or refreshing models on one tab never touches the other side's runtime catalog or sessions.
- **Multiplier in the model name** — model names show the credit multiplier in Trae's own menu format (e.g. `GLM-5.2 · x0.79`), updated with each directory refresh.
- **DSH local tool loop** — gets pending structured `tool_calls` from Trae `llm_utils_chat`, lets DSH execute its own local tools, then returns tool results to the model.
- **Dual-region detection (CN / international)** — detects local sign-ins across Trae CN, TRAE SOLO CN, Trae, and TRAE SOLO installs. The region is derived from the credential's own `userRegion` claim (host suffix and edition label as fallbacks), with no manual switch.
- **Region-isolated directories and selections** — CN and international each keep their own model directory, enabled picks, image opt-ins, and context budgets, and each provider reads only its own slot.
- **Vision follows Trae's own declaration** — when Trae marks a model `multimodal`, the plugin advertises it as such with no manual tick per model (issue #16). The rule is "**models you tick ∪ models Trae marks multimodal**": models Trae marks `false`, or does not mark at all, stay text-only and can still be turned on by hand. A row enabled automatically is shown ticked and read-only, with the reason. See "Image input" below.
- **Account switching** — refreshes the token list and lets users select an account without storing tokens in DSH settings. **Your choice is remembered and stays in effect**: the plugin will never switch accounts on its own just because the bound one ran out of credit or another usable one was found (switching bills a different person). So when the bound account is exhausted the card **says so explicitly** and lists the other accounts on this machine that still have credit, with their balances, for you to switch to in one click — instead of showing an empty panel or quietly rebinding you. "Refresh accounts & tokens" now always reports what happened (how many accounts were found, who is still bound) instead of appearing to do nothing. The dropdown names the product (`Trae` / `TRAE SOLO` / international) so a credential left behind by an uninstalled app is recognisable.
- **Read-only usage and model management** — Work/general credits on CN accounts, subscription/trial status on international ones; enable Trae models freely. Read-only queries consume nothing.
- **One-click test of the enabled models** — sends each **enabled** model one minimal message (a single `ping`, no tools) and reports whether it actually answers: **works** / **needs a higher plan** (Trae `1005`; your plan does not cover it) / **not served** (`4001`/`4011`; no SOLO function serves it) / **throttled** / **sign-in rejected** / **not determined**. The last one is a first-class outcome: a timeout, a dropped connection, a proxy or a 5xx is **never** reported as unusable — only an explicit upstream refusal is a negative verdict. This is the plugin's **only** operation that spends quota (check-in changes account state but spends nothing), it runs only when you click, and its results live in the current session rather than in your settings.
- **Daily check-in claiming** — a one-click claim on the CN card (the button shows the daily reward, and reads "Claimed today" and disables itself once that account has been paid). This is the plugin's **only** operation that changes account state, and it runs only when you click. Trae allows **one check-in per device per day**: after switching accounts, if this machine's slot is already spent (by any account), the selected account cannot claim here that day — the card explains that rather than pretending the account was paid. The international side has no check-in activity, so no button is shown there.
- **Composer credit readout** — the composer tool row (between "Expert" and the model selector) shows "Trae CN credits <n>" with a refresh icon, refreshing every 5 minutes. It appears **only while the session's selected model belongs to this plugin**, and renders nothing for any other provider — which is what keeps two connector plugins from competing for one shared row (the sidebar foot is a shared root row; the composer row is per-session and provider-scoped).
- **Sidebar credits** — a permanent "Trae CN credits: <n>" line with a refresh button sits at the bottom of the left sidebar (below the workspace list, above Settings), refreshing every 5 minutes and on demand. **Hidden by default**; tick "Show credits in the DSH main UI" in the plugin card to show it (the same switch appears at the top of the card and beside the model actions). Once shown, unticking it removes the row completely — the row itself carries no control, so the switch lives with the account and model settings it belongs to. It shows the **general** credit pool — the one SOLO chat actually spends — so the number matches the card, and the line disappears when the sidebar is collapsed. The international region is subscription-based and has no comparable number, so nothing is shown there.
- **Secure loopback shim** — one random port + in-process random secret per region; the real Trae token is never handed to pi-ai.

## How it works

```text
DSH PiAiAdapter (one stack per provider)
  -> secure loopback shim (one random port + in-process random secret per region)
  -> TraeSoloBridge
  -> CN: https://trae-api-cn.mchost.guru/api/agent/v3/llm_utils_chat
  -> Global: https://coresg-normal.trae.ai/api/agent/v3/llm_utils_chat
  -> Trae SSE / pending function_call
  -> OpenAI SSE tool_calls
  -> DSH executes local tools and returns their results
```

The CN and international sides each own a complete runtime stack — credential store, model catalog, wire map, upstream clients, loopback shim, adapter — with visibility filtered by the credential's own region claim, so **both regions' accounts can be signed in and used by different sessions at the same time**.

Usage overview hits the read-only `https://api.trae.cn/trae/api/v2/pay/*` and `/trae/api/v2/ug/*` endpoints (international accounts read their own gateway's subscription status); the daily check-in claim is the one write among them, going to `POST /trae/api/v2/ug/checkin_credits/claim` with this installation's device id (`x-device-id`, the same identity the chat path sends). That device id is also what Trae keys the "one check-in per device per day" rule on, so switching accounts does not reset the day's slot. Refreshed tokens are kept per region in `$DSH_HOME/.trae-auth.cn.json` and `$DSH_HOME/.trae-auth.ai.json` (two simultaneously signed-in accounts never overwrite each other; the legacy single file `.trae-auth.json` is still read as a migration source).

> See `docs/IMPLEMENTATION_PLAN.md`, `docs/SOLO_ROUTE_DECISION.md`, `docs/USAGE_API_RESEARCH.md`.

## Image input

The plugin declares whether a model accepts images, and DSH uses that to decide whether an attachment is **sent as-is** or **degraded into a text description**. That makes the declaration a hard switch, not a cosmetic label.

The rule is the **union of two sources** (issue #16):

| Source | Meaning |
|---|---|
| Trae's own `multimodal` field | Trae's own answer to "does this model read images". The Trae IDE's attach-image button is driven purely by this field, with no user switch |
| Your manual `imageModelIds` ticks | Explicit choice. Even if Trae later stops reporting the flag for that model, your tick is never revoked |

Notes:

- **Only `multimodal === true` enables it automatically.** A missing field (a directory saved by an older release, a fallback row) or an explicit `false` stays text-only — better to not send than to advertise a capability we cannot confirm.
- **Automatic does not mean automatic sending.** It only lets DSH attach an image to that model; you still choose to attach one per message. The plugin never sends an image on your behalf.
- **An automatically enabled row is shown ticked and read-only.** Under the union, unticking it would be re-applied immediately, so offering a clickable box would be a lie. There is currently no per-model "force off" escape hatch; if you want one, say so on issue #16.
- Manual ticks still work for models Trae marks `false` (or does not mark), which is the escape hatch for "upstream does not say so, but it actually works".

## Model coverage

This plugin serves models from Trae's **SOLO channel** (`DeepSeek-V4-Flash-Official`, `DeepSeek-V4-Pro-Official`, `GLM-5.3`, `GLM-5.2`, `Kimi-K3`, `MiniMax-M3`, `Qwen3.8-Max`, `Doubao-Seed-*`, …), for both the domestic and international sides.

The following three models currently come from the **TraeCode (Trae IDE) channel** and have **not** been opened up to the SOLO channel:

| Model |
| --- |
| `glm-5.3-flash` |
| `kimi-k2.8-preview` |
| `qwen3.8-flash` |

They **do appear in the model list** (Trae's directory advertises them), but the plugin has no channel that can call them yet. Sending a message with one selected produces an **explicit error**, for example:

```
Trae does not serve this model under the SOLO function the request used
(config_name rejected) · Trae code 4001 · upstream: We're sorry, the param is invalid…
```

That is the upstream refusal stated plainly, rather than a silent failure or something that reads like a network fault. **Once Trae opens them up to the SOLO channel the plugin picks them up automatically** (the test is simply whether a callable id can be resolved) — no plugin upgrade needed.

> **Why they are listed now (policy from 2026-10-02)**: such rows — present in the directory but with no resolvable callable id — used to be **hidden outright**, on the grounds that showing one only produces an error. But the callable rosters are issued **per account tier**: not seeing a model on a free account does not prove a paying account cannot call it (the reporter in issue #19 is on Pro, and their account calls models this machine's free account gets gated on). **Hiding models the user's own Trae IDE lists is worse than showing an explicit error**, so the behaviour is now: list everything, report refusals honestly.

> `deepseek-v4.1-flash` used to be listed here — `docs/DS41_CALLABILITY.md` (evidence gathered 2026-09-15) measured `4001 param is invalid` from all eight SOLO functions. **Trae has since opened it up to the SOLO channel**: it now ships in the live directory with `wireFunction: solo_work_remote` and calls succeed (verified against a live refresh). This page had not caught up, so it is removed from the table.

> Note the distinction: **`GLM-5.3` is supported** (it goes through the SOLO channel), but **`glm-5.3-flash` is not** — they are different models.

To use these three models today, use the **Trae IDE itself**.

## Install

```sh
dsh plugin --profile desktop add dsh-connect-trae
```

Or directly via npm:

```sh
npm install dsh-connect-trae
```

Restart the DSH process after install/update/uninstall.

## DSH version compatibility

**Requires DSH 0.1.7-rc.1 and up** (since 2.3.0 the plugin no longer targets hosts older than 0.1.7; the peer dependency ranges are narrowed accordingly).
**The peer upper bound is `<0.3.0-0`, so both the 0.1.7 and the 0.2 line are supported.**

The 0.2.0 line breaks **no** contract this plugin consumes — a symbol-by-symbol check confirmed every API it imports is unchanged ([full 0.2.0-rc.1 impact check](https://github.com/dingminhua/dsh-connect-trae/blob/main/docs/DSH_0.2.0_RC1_IMPACT_CHECK.md)). But since 0.1.7 DSH enforces a **bundle-level peer gate**: a bundle whose peers are unsatisfied is skipped **whole**, with one line on stderr and nothing in the UI — the plugin simply disappears.

### Why the upper bound is not `<0.2.0`

2.3.1 wrote `<0.2.0-0`, meaning "not the 0.2.0 release yet". That spelling is **wrong**: in SemVer `0.2.0-rc.1 < 0.2.0-0`, so it excluded the entire 0.2.0 **prerelease** line, and the plugin went dead the moment a user installed the first 0.2.0 prerelease.

| Spelling | 0.1.7 line | 0.2.0 alpha/rc | 0.2.0 release | 0.3.0 |
| --- | --- | --- | --- | --- |
| `>=0.1.7-rc.1 <0.2.0-0` ❌ | ✅ | ❌ | ❌ | ❌ |
| `>=0.1.7-rc.1 <0.2.0` | ✅ | ✅ | ❌ | ❌ |
| `>=0.1.7-rc.1 <0.3.0-0` ✅ | ✅ | ✅ | ✅ | ❌ |

`tests/dsh-peer-range.spec.ts` pins this invariant: every peer range must admit the 0.1.7 and 0.2 lines, must reject the 0.3 line, and `<0.2.0-0` may not come back.

> **Why this needs a dedicated test**: a wrong range passes `tsc`, every unit test, `pnpm install`, and CI — only a real host refuses to load it. That is exactly how 2.3.1 shipped green.

0.1.7 rebuilt the settings machinery, and the plugin follows the 0.1.7 contract:

- **Host registration**: `SettingsForms.configure({auto}, owner)` (`installSection` was removed in 0.1.7), and the namespace is the **Loader entry id the host actually serves** (`ctx.fiber.entry?.options.id`, falling back to `trae`) — the harness looks a provider's namespace up by exact match, so hard-coding `trae` made the provider read as "not configured".
- **Client settings surface**: `configForms` (`settingsScope` was removed in 0.1.7). `inject` declares only `slots` / `locale`; the settings surface is probed with `ctx.get()`. Cordis' dependency gate is hard — any `inject` entry the running line does not provide keeps `apply()` from ever running (this is why 2.2.0 and earlier sat at `pending (waiting for service: settingsScope)` on 0.1.7).
- **Config card slots**: `plugins.bundle.config` / `plugins.row.config` (`settings.plugin.item` was removed).
- **Schema writable marker**: writable fields must be marked `volatile()` (`asVolatile`), or 0.1.7's write gate rejects every write; 0.1.7 delivers config values as `{get(): T}` live references, so every read and merge path unwraps them first (`unwrapVolatile` / `unwrapVolatileDeep`).
- **The collapse caret is pure CSS**, with no static primitives icon import — icon naming changes across releases, so a static import is not a stable contract.

## Platform support

| Platform | Status | Notes |
| --- | --- | --- |
| **macOS** | ✅ Fully supported | Development and verification environment; directory names confirmed on a real host |
| **Windows** | ✅ Supported | CI runs `windows-latest`; account directory, app version headers, and lock behavior all handled. **Verified on a real host** (Windows 10.0.22621 + TRAE SOLO CN) — see below |
| **Linux** | ✅ Supported | Includes the WSL2 + Trae CLI case (issue #5); directory names probed as multiple candidates |

All three platforms share one implementation: account discovery, decryption, region routing, check-in, and usage queries are platform-independent. Platform differences are confined to **path resolution** (`src/paths.ts`) and the **device fingerprint** (`src/identity.ts`).

## Windows notes

- **Account data directory**: the plugin reads `%APPDATA%\<directory name>\User\globalStorage\storage.json` (unrelated to the **install** directory — this Electron family keeps user data under `%APPDATA%` even when installed on another drive). It probes several directory spellings **in parallel** (`Trae CN` and `trae-cn`, `TRAE SOLO CN` and `trae-solo-cn`), and any hit works. Windows file systems are case-insensitive, so the same directory is never probed twice.
- **App version headers**: read from `<LOCALAPPDATA>\Programs\<install directory name>\resources\app\product.json` (falling back to `<home>\AppData\Local` when `LOCALAPPDATA` is unset) and sent as `x-app-version` / `x-ide-version`; if unreadable those headers are omitted and nothing else is affected.
- **Device fingerprint**: `x-device-type` is sent as `windows` and `x-os-version` as `Windows <release>`. The machine id comes from the data directory's `telemetry.machineId` (or a sibling `machineid` file), which holds on Windows.
- **File locking**: the host's `dsh-atomic-write` handles Windows exclusive-create semantics (`EPERM` / `EBUSY` retries) natively; no plugin-side adaptation is needed.
- **Raw Chat probing (known limitation)**: `model-cache` depends on the `sqlite3` command-line tool, which is not installed by default on Windows; that probe fails and **falls back safely**. Raw Chat is off by default and does not affect the main flow.
- **Permission bits**: credential copies are written with `mode: 0o600` / `dirMode: 0o700`, which Windows ignores — no error, documented as harmless.

### Real-host verification result (2026-09-26, Windows 10.0.22621 + TRAE SOLO CN)

`node scripts/verify-windows.mjs` passed **everything** (exit code 0):

| Check | Observed |
| --- | --- |
| Directory probe | Hit `%APPDATA%\TRAE SOLO CN\User\globalStorage\storage.json` (all other candidates missing) |
| Account resolution | 1 account resolved, `solo` / `cn` region |
| `x-device-type` | `windows` ✅ |
| `x-os-version` | `Windows 10.0.22621` ✅ |
| `x-device-id` | 16 digits, all numeric (read from the data directory, not the fallback hash) ✅ |
| `x-app-version` | `0.1.56`, read from `%LOCALAPPDATA%\Programs\TRAE SOLO CN\resources\app\product.json` ✅ |

**What this confirms**: using `win32DirName` as the authority is **correct** — the `TRAE SOLO CN` spelling really is the directory name on a real Windows host, and both the `product.json` install-path derivation and every device-fingerprint field hold. In other words "the plugin can read Trae's sign-in on Windows" is now backed by real evidence rather than inference.

#### Runtime paths beyond the script (same host, 2026-09-26)

The six checks above cover **path probing and the device fingerprint only** — that is not the same as "the whole plugin works on Windows". So the plugin's main flows were exercised separately, calling the `lib/` exports directly (i.e. the product code itself):

| Runtime path | Observed |
| --- | --- |
| `TraeCredentialStore.resolve()` | ✅ returned a credential, host `https://api.trae.cn`, token expiry parsed |
| `identityHeaders()` (all headers) | ✅ all 10 headers produced (`x-device-id` / `x-machine-id` / `x-device-cpu` / `x-ide-version-code`, …) |
| Usage query (read-only, consumes no credits) | ✅ 9 credit packs, total 2050 / consumed 1522.85 |
| Model directory fetch (read-only) | ✅ **42 models** returned |
| `writeFileAtomic` | ✅ write + read-back identical |
| Concurrent `withFileLock` | ✅ 8 concurrent writers serialized correctly with **no lost updates** (Windows exclusive-create semantics are handled by the host — now verified rather than assumed) |
| `SSE` decoding | ✅ splits on `\r?\n`, so CRLF and chunk splits are both handled |

In short: sign-in, identity, usage, model directory, and concurrent writes are all **verified working on Windows**.

> **Known limitation (its behaviour confirmed on this host)**: `model-cache` depends on the `sqlite3` command-line tool, which is not installed here; it threw `ENOENT` (`spawn sqlite3 ENOENT`) and the caller's `.catch(() => undefined)` fell back correctly — **the main flow is unaffected**, and Raw Chat is off by default.
>
> **That module's directory-spelling gap has been fixed** (found and fixed in the same round): it used to **hardcode the single spelling `Trae CN`** for the `state.vscdb` path while `paths.ts` probes multiple candidates, and it re-derived the directory instead of reusing `traeStorageCandidates`. On this host — whose real directory name is `TRAE SOLO CN` — the old code pointed at `...\Trae CN\...\state.vscdb`, which **does not exist at all**; only because `sqlite3` is absent did that call necessarily fail and fall back, hiding a **wrong path** behind a different, plausible-looking error (a missing dependency).
>
> The fix derives the cache path **from the credential path**: `state.vscdb` and `storage.json` share one `globalStorage` directory, so the candidate that yields the sign-in also owns the cache. `raw-resolver` now passes the resolved candidate down, so a machine with several editions installed cannot read another installation's model map. Re-measured on the real host: the new code selects `%APPDATA%\TRAE SOLO CN\User\globalStorage\state.vscdb` (which exists), where the old code only ever looked at `Trae CN` (which does not).

> **What remains unverified**: this host only had TRAE SOLO CN installed, so the `Trae CN` / `trae-cn` spellings are **still unconfirmed on a real host** — their absence here only means this build is not installed, not that the spelling is wrong. Windows users running Trae China Edition are still welcome to run the command above and report.

> **Running Trae China Edition, or a different setup? One command reports it**: `node scripts/verify-windows.mjs` — it uses the plugin's own build output to list every path it probes on this machine, whether an account can be resolved, and the device fingerprint. Its output is **already redacted** (user name becomes `<user>`; account and device ids are reported as shape only) and can be pasted into an issue as-is. **Full steps and how to read the result are in [`docs/WINDOWS_VERIFY_GUIDE.md`](https://github.com/dingminhua/dsh-connect-trae/blob/main/docs/WINDOWS_VERIFY_GUIDE.md)**; step-by-step manual troubleshooting is in [`docs/WINDOWS_TOKEN_PROBE.md`](https://github.com/dingminhua/dsh-connect-trae/blob/main/docs/WINDOWS_TOKEN_PROBE.md) (**it only asks for directory and key names, never for tokens**). If the directory name still does not match, `authFile` + `edition` can point at the exact path as a workaround.

## Development

```sh
pnpm install
pnpm run check   # typecheck + test + build
```

Local dev via a `link:` install to the desktop profile (restart DSH Desktop after editing):

```sh
dsh plugin --profile desktop add /Users/dmh2002/DshProject/dsh-connect-trae
```

## Acknowledgements

- [Wang-JQ77/dsh-trae-api](https://github.com/Wang-JQ77/dsh-trae-api) (MIT) — Reference implementation for research into Trae authentication, sessions, and model protocols.

## Third-party open-source dependencies

The open-source projects referenced for Trae integration (architecture/protocol research), together with their licenses and compliance notes, are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). When introducing new Trae-related external dependencies or reusing code from other projects, update that file accordingly and honor the upstream licenses.

## License

This project is licensed under the [MIT License](LICENSE). Copyright: **Copyright (c) 2026 LaoDing**.

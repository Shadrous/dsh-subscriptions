# 📦 @goodandready/dsh-subscriptions — Shadrous fork

> Fork of the upstream `@goodandready/dsh-subscriptions` plugin for DeepSeek Harness. It keeps the upstream package name so DSH can replace the npm package in place, but it is **not published to npm**. Install it from this GitHub repository or link a local checkout.

**Current fork version:** `0.6.73-local.14` (based on upstream `0.6.72`).

<p align="center">
  <a href="https://github.com/Shadrous/dsh-subscriptions"><img src="https://img.shields.io/badge/GitHub-Shadrous%2Fdsh--subscriptions-181717.svg?style=for-the-badge&logo=github&labelColor=1a1a2e" alt="GitHub repository"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-10b981.svg?style=for-the-badge&labelColor=064e3b" alt="License"></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/DSH-Plugin-8b5cf6.svg?style=for-the-badge&labelColor=2e1065" alt="DSH Plugin"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-22.19%2B%20%7C%2024%2B-f59e0b.svg?style=for-the-badge&labelColor=451a03" alt="Node version"></a>
</p>

---

## Why this fork

The upstream plugin is excellent; this fork keeps the same vendor bridges and adds the fixes and UI behaviour used by the maintainer:

- **Grok prompt caching** — a stable `prompt_cache_key` per session and `input_tokens_details.cached_tokens` parsing, so Grok cache hits show up instead of staying at 0%.
- **Antigravity login** — uses the public AGY OAuth client with the `http://localhost:51121/oauth-callback` redirect, and the loopback listener binds both IPv4 and IPv6 (`localhost` is often `::1` on Fedora).
- **Antigravity quota** — reads the real quota buckets from the same daily backend the Antigravity CLI uses. It merges `retrieveUserQuotaSummary` (Claude/GPT weekly + 5h) with `retrieveUserQuota` (live per-model buckets, including the Gemini 5h window), because Google sometimes drops the Gemini group from the summary response. A `0%` reading is a live “full” reading; hover the pill for the reset countdown.
- **Gemini thinking effort** — `Gemini 3.8 Flash`, `Gemini 3.7 Flash`, and `Gemini 3.5 Flash` appear once in the picker with a low/medium/high thinking selector. The catalog's repeated alias rows (including four identical `Gemini 3.5 Flash Lite` entries) are deduplicated by display name. Legacy ids such as `gemini-3.8-flash-high` still work for existing chats; new requests map the selected effort to the backend model or `-tiered` id that encodes it.
- **Cost-meter pricing** — registers Antigravity model price references with `dsh-cost-meter`, so Gemini/Claude/GPT calls are priced instead of showing “No priced cost”. Existing user overrides win, and new calls are priced automatically.
- **Header pill** — follows the open chat's selected model, shows only the caps the vendor actually reports, orders them `5h → W → M`, refreshes while visible, and **disappears when the chat is not on a subscription provider**.
- **Grok cap labels** — the weekly cap is labelled `W`, not the structural `config` key.
- **Resilient startup** — the optional SOCKS proxy client loads lazily, so a missing `socks` install can no longer make the whole plugin inactive and unhook every provider.

---

## Requirements

- DeepSeek Harness `0.2.x` with the `web` profile.
- Node.js `22.19+` or `24+`.
- pnpm (DSH uses it to install profile plugins).

---

## Install this fork

The package name deliberately stays `@goodandready/dsh-subscriptions`: DSH resolves the loader entry and the profile dependency by that name. Do not install this fork alongside the upstream npm package.

### Option A — link a local checkout (recommended for development)

```bash
git clone https://github.com/Shadrous/dsh-subscriptions.git ~/src/dsh-subscriptions
cd ~/src/dsh-subscriptions
pnpm install --prod
```

The `pnpm install --prod` step is required: DSH supplies the host peer packages, but the linked checkout needs its own runtime dependencies (`socks`, `undici`) in `node_modules`. The checkout pins `autoInstallPeers: false` in `pnpm-workspace.yaml`, so this command only installs those runtime dependencies.

Install the checkout into the profile:

```bash
dsh plugin --profile web add "$PWD"
```

If the profile already depends on the upstream npm package, `add` may report `already-installed`. In that case, point the profile at the checkout with a link override. Edit `~/.dsh/profiles/web/pnpm-workspace.yaml`:

```yaml
overrides:
  '@goodandready/dsh-subscriptions': link:/absolute/path/to/dsh-subscriptions
```

Then reinstall the profile dependencies and restart DSH:

```bash
cd ~/.dsh/profiles/web
pnpm install
```

This is the setup used by the maintainer's own profile: the symlinked package is updated by `git pull`, and reinstall still resolves to the working fork instead of the broken npm copy.

### Option B — install directly from GitHub

```bash
dsh plugin --profile web add github:Shadrous/dsh-subscriptions
```

This lets pnpm fetch the repository and install its production dependencies. If the package is already present from npm, remove the npm copy first (or use Option A).

After either option, restart the `dsh web` process (or its systemd unit) so the host-side modules load. Then open **Settings → Plugins → Plugin Settings → Subscriptions**.

---

## Updating this fork

### Linked checkout

```bash
cd ~/src/dsh-subscriptions
git pull --ff-only
pnpm install --prod
```

Restart `dsh web` after `git pull`. Client-only changes can hot-reload, but host modules (`lib/index.js`, `lib/proxy.js`, vendor code) need a restart. If the header pill does not update, refresh the browser once.

### GitHub install

```bash
dsh plugin --profile web add github:Shadrous/dsh-subscriptions
```

Then restart `dsh web`.

> [!WARNING]
> Do **not** use the in-app **Update** button in the Subscriptions settings card. It checks the upstream npm registry and installs `@goodandready/dsh-subscriptions@latest`, which would overwrite this fork with the upstream package. Update with `git pull` (linked checkout) or the GitHub install command above.

---

## Connect accounts

Open **Settings → Plugins → Plugin Settings → Subscriptions**, or the local overview page:

```text
http://127.0.0.1:3080/dsh-subscriptions/subscriptions
```

- Connect each vendor with its normal OAuth/device/API-key flow.
- Multiple accounts per vendor are supported (`CODEX_OAUTH_1`, `CODEX_OAUTH_2`, …) and rotate automatically.
- **Antigravity** uses the public AGY client and the `http://localhost:51121/oauth-callback` redirect. The callback listener binds both IPv4 and IPv6, so `localhost` resolving to `::1` works.
- **Headless / remote**: use the account card's manual callback-URL or authorization-code paste fallback.
- Tokens are stored by DSH's credentials service; they are never returned through the plugin's HTTP endpoints.

---

## The header pill

The pill is intentionally scoped to subscription chats:

- It appears only when the open chat's selected model belongs to one of this plugin's providers.
- It disappears on DeepSeek and every other non-subscription model — there is no fallback to the last subscription request.
- It refreshes every 5 seconds while visible, and stops polling while hidden.
- Caps are adaptive and ordered:
  - Premium with 5-hour and weekly windows: `Codex · 5h: 12% | W: 4%`
  - Weekly-only (e.g. Grok): `Grok · W: 79%`
  - Monthly-only: `Codex · M: 17%`
  - Gemini with model-family windows: `Antigravity · 5h: 0% | W: 0%`

Click the pill for the account modal: connected accounts, cooldowns, quota bars, and a shortcut to the settings card.

---

## Quota and cost readings

- **Quota** comes from the vendor's live quota buckets on `daily-cloudcode-pa.googleapis.com` — the same host the stream and the Antigravity CLI use. `retrieveUserQuotaSummary` normally reports the Claude/GPT weekly and 5-hour windows; Google has started returning that group without the Gemini group for some consumer accounts. The plugin therefore also reads `retrieveUserQuota`, whose per-model buckets still carry the live Gemini 5-hour window, and merges the two sources. The pill filters the result to the open model's family. A `0%` pill value means 0% used / 100% remaining, not missing data; hover the pill for the reset countdown.
- While the summary omits Gemini, the plugin fills the missing weekly cap from the local Antigravity CLI's read-only `agy -p /quota` output, cached for five minutes (`DSH_SUBSCRIPTIONS_CLI_QUOTA=0` disables it). If the CLI is absent, only the live Gemini 5-hour cap is shown. If Google's summary response returns a Gemini weekly bucket again, that live value wins automatically.
- **Cost** is owned by `dsh-cost-meter`, not this plugin. When both plugins are installed, this fork registers Antigravity model price references (`antigravity:gemini-3.8-flash-high` → `google:gemini-3.8-flash`, and equivalents for the other Gemini/Claude models). New calls are priced automatically, and existing user price overrides are preserved.
- Cost-meter does not retroactively reprice recorded calls. To update the cost of previous Antigravity calls, open **Settings → Cost → Historical pricing**, choose `antigravity:gemini-3.8-flash-high`, and run **Recalculate this model**. The operation keeps the original amounts and writes a ledger backup.

## Supported built-in providers

| Vendor key | Subscription tier | Notes |
|---|---|---|
| `codex` | ChatGPT Plus / Pro | Codex streaming, tools, images |
| `claude` | Claude Pro / Max | Native Messages protocol, usage tracking |
| `grok` | xAI / X Premium | Reasoning, billing checks, prompt caching |
| `antigravity` | Google Cloud Code Assist | Antigravity / Gemini quota windows |
| `kimi` | Moonshot Kimi | OAuth device flow |
| `glm` | Z.ai GLM Coding Plan | Coding endpoint and quota monitor |
| `cursor` | Cursor | Billing-period usage |
| `kiro` | AWS Kiro | Desktop OAuth, streaming |
| `copilot` | GitHub Copilot | GitHub device flow |
| `qwen` | Alibaba Qwen (DashScope) | OpenAI-compatible endpoint |
| `ernie` | Baidu ERNIE (Qianfan) | OAuth2 token refresh |
| `spark` | iFlytek Spark | OpenAI-compatible endpoint |
| `jetbrains` | JetBrains AI Assistant | JetBrains AI relay |
| `perplexity` | Perplexity Pro | Sonar model catalog |
| `replit` | Replit Core | Connect-token auth |
| `cody` | Sourcegraph Cody Pro | Access-token auth |

Custom vendors can still be registered through the upstream `createVendorFromProfile` factory.

---

## Common configuration

Most options are editable in the settings card. Low-level settings live in `settings.yaml`:

```yaml
dsh-subscriptions:
  switchAtRemaining: 1
  cooldownMs: 60000
  autoLoopback: true         # catch loopback OAuth callbacks automatically
  privacyMask: false         # mask emails/account identifiers in the UI
  composerQuota: 'off'       # off | percent | bar | forecast
  codexFastMode: false       # service_tier priority (1.5x speed tier)
  codexVerbosity: ''         # low | medium | high
  enableToasts: true
  enableQueue: true
  accountMaxConcurrency: 2
  maxQueueSize: 20
  queueTimeoutMs: 30000
  streamConnectTimeoutMs: 180000  # wait for response headers (large/high-reasoning prompts)
  streamIdleTimeoutMs: 60000      # abort only when a connected stream goes silent this long
  accounts:
    codex:
      - ref: CODEX_OAUTH_1
        label: "Work Pro Account"
    grok:
      - ref: GROK_OAUTH_1
        label: "X Premium"
```

Per-slot fields also accept `expiresAt` (epoch ms) and `proxyUrl` (`http://`, `https://`, `socks5://[user:pass@]host:port`).

---

## Troubleshooting

**The plugin is installed but no subscription providers appear**

Check that the plugin entry is active rather than merely enabled:

```bash
curl -s http://127.0.0.1:3080/dsh-subscriptions/status
```

A 404 or a `fiberPhase` that never reaches `active` usually means the linked checkout is missing runtime dependencies. Run `pnpm install --prod` in the checkout, then restart `dsh web`.

**`Cannot find package 'socks'`**

The linked checkout has no `node_modules`. Run:

```bash
cd /path/to/dsh-subscriptions
pnpm install --prod
```

This fork also lazy-loads the SOCKS client, so the plugin will now stay active even if `socks` is missing; only SOCKS proxy requests fail.

**Reinstalling keeps bringing back this checkout**

That is the profile link override in `~/.dsh/profiles/web/pnpm-workspace.yaml`. It is intentional. Remove the override only if you want to return to the upstream npm package (not recommended for this fork).

**Antigravity login succeeds in the browser but DSH stays disconnected**

Give the callback a moment and refresh the page. Ensure nothing else is bound to port `51121`; the loopback listener is dual-stack. If the browser cannot reach the loopback address, use the manual paste fallback in the account card.

**The pill shows `config` instead of `W`**

That was an upstream parsing bug fixed in this fork. Update the checkout (`git pull`), reinstall optionally, and restart `dsh web`.

**The pill is missing on this chat**

That is expected when the selected model is not from this plugin (for example `deepseek-flash`). Switch the model picker to a subscription provider and it reappears.

**A long turn fails with `The operation was aborted due to timeout`**

This fork used one 30s deadline for both the wait before the first response byte and the idle timeout after the stream connected. A large prompt with high reasoning effort can legitimately take longer than that to produce its first byte, so the request was killed before the model answered. The connect budget is now `streamConnectTimeoutMs` (default 180s) and is separate from `streamIdleTimeoutMs` (default 60s). Raise `streamConnectTimeoutMs` if your provider is slower; lower it if you want a stalled connection to fail sooner. A timeout is not retried, because retrying only doubles the wait.

**Claude thinking fails with `max_tokens` must be greater than `thinking.budget_tokens`**

Antigravity translates the Gemini-shaped request to Anthropic for Claude models. The plugin used to send a thinking budget (8192 for medium) while letting the backend default `max_tokens` to the same 8192. `googleContents` now sets `maxOutputTokens` to at least `thinkingBudget + 8192`, so the budget always leaves room for the answer.

**A turn says `HTTP 500` and mentions `QUOTA_SERVICE`, but the quota pill shows plenty left**

That is a Google **quota-service outage**, not an exhausted subscription. The 500 response contains `"reason": "QUOTA_SERVICE"` and `validating quota: generic::internal`, and the old error classifier saw the word `quota` and turned it into a `RATE_LIMIT`, parking the account for an hour. A 5xx is now classified as transient: the same account is retried twice with a short backoff and is never quarantined. If the backend keeps failing, the turn reports the transient error and the next attempt starts immediately instead of waiting for a cooldown.

**The Gemini weekly cap disappeared from the pill**

Google's `retrieveUserQuotaSummary` response has started omitting the Gemini group for some consumer accounts, leaving only Claude/GPT. The plugin merges that summary with `retrieveUserQuota`, whose per-model buckets still expose the live Gemini 5-hour window. For the missing weekly cap it falls back to the local Antigravity CLI's read-only `agy -p /quota` output, cached for five minutes; the CLI still reports the weekly window. If the CLI is not installed, only the 5-hour cap can be shown. Set `DSH_SUBSCRIPTIONS_CLI_QUOTA=0` to disable the CLI fallback entirely. If Google restores the Gemini group in the summary, that live value wins automatically.

**The model picker still shows `gemini-3.8-flash-high` / `-medium` / `-low` as separate models**

Those are the upstream catalog ids. The fork now collapses `Gemini 3.8 Flash`, `Gemini 3.7 Flash`, and `Gemini 3.5 Flash` into one entry each with a low/medium/high thinking selector, maps the selected effort to the backend id that encodes it, and deduplicates rows that share a display name (the catalog lists `Gemini 3.5 Flash Lite` four times under different legacy ids). Existing chats pinned to a suffixed id keep working. If your picker still shows the old entries, restart `dsh web` so the host reloads the vendor module and click **Sync Models**; a browser refresh alone is not enough.

---

## Development

```bash
# runtime dependencies only (enough for a linked install)
pnpm install --prod

# full dependency set, if you are working on the plugin
pnpm install

# syntax-check the files you changed
node --check lib/client.js
node --check lib/index.js
```

The package name must stay `@goodandready/dsh-subscriptions`; the profile links and the DSH loader resolve by that name. The bundle patch is `cordis.patch.yml` and the host/client entry points are under `lib/`.

The upstream `pnpm test` / `pnpm typecheck` scripts expect the upstream `test/` and TypeScript/ESLint configs, which this trimmed fork does not include. Use the syntax checks above and verify the installed plugin through the status endpoint and the Web UI.

---

## Credits and license

- Upstream project: [GooDAnDReaDY/dsh-subscriptions](https://github.com/GooDAnDReaDY/dsh-subscriptions).
- Fork maintained by [Shadrous](https://github.com/Shadrous).
- MIT license. See [LICENSE](LICENSE).

The upstream `README.ru.md` and `README.zh.md` files are retained for reference but describe the upstream package, not this fork. This English README is the maintained one.

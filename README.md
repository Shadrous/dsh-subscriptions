# 📦 @goodandready/dsh-subscriptions — Shadrous fork

> Fork of the upstream `@goodandready/dsh-subscriptions` plugin for DeepSeek Harness. It keeps the upstream package name so DSH can replace the npm package in place, but it is **not published to npm**. Install it from this GitHub repository or link a local checkout.

**Current fork version:** `0.6.73-local.7` (based on upstream `0.6.72`).

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
- **Antigravity quota** — reads the real quota-summary buckets (Gemini and Claude/GPT `5h`/weekly windows) instead of collapsing the account to a single synthetic 0%.
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

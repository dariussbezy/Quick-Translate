# Quick Translate for Valenced — 2.0.0-beta2

A fresh TypeScript implementation based on the behavior of the old Rain plugin. The old source is not included. The interface, language names, and documentation are in English.

Target: **Valenced 1.3.0 and Discord 352.6 Alpha**. The manifest accepts Valenced API `>=1.3 <2` and Discord `>=352.6 <352.7`. These constraints declare the intended target; they do not replace device testing.

## Install using a repository URL

1. Open **Settings → Valenced → Plugins → repository settings**.
2. Paste this full URL into **Repository URL**, then tap **Add repository**:

```text
https://raw.githubusercontent.com/dariussbezy/Quick-Translate/refs/heads/codex/quick-translate-valenced-beta/QT/index.json
```

3. Return to **Plugins**, tap **+**, find **Quick Translate**, and install it.
4. Enable the plugin and reload Discord.
5. Open Quick Translate settings to select your languages.

Use the full `index.json` URL above. A GitHub repository page URL is not a Valenced plugin index.

Future published builds can be installed through Valenced's repository updates. If you installed beta1 from a ZIP, add this repository and use the plugin's **Updates → Repository** option to select Quick Translate as its source.

This repository currently points its `latest` channel to a **beta** build for testing. Both the index and plugin artifacts stay under `QT` on the `codex/quick-translate-valenced-beta` branch. The main branch is unchanged.

## Install from a ZIP instead

Download the [beta2 plugin ZIP](https://github.com/dariussbezy/Quick-Translate/raw/refs/heads/codex/quick-translate-valenced-beta/QT/Quick-Translate-Valenced-2.0.0-beta2.zip), then use **Install from file** in Valenced repository settings. Do not extract it or use GitHub's whole-repository “Download ZIP” as a plugin. ZIP-only installations have no automatic update source until you select a repository.

Plugin ID: `dariuss.quick-translate`. Rain/Kettu settings are not imported automatically.

## Features

- Google Translate and DeepL, including personal DeepL Free API keys.
- Separate incoming and outgoing languages and automatic source-language detection.
- Translation panel with editable text, copying, draft replacement, and original-draft restoration with conversation/edit checks.
- A Translate composer button and a Translate action in the message long-press menu, subject to Discord's private module compatibility.
- Local message display below the original or in its place, without editing the message store's content in the renderer.
- Per-conversation languages and up to six favorite languages.
- Optional outgoing auto-translation. A translation error rejects sending instead of silently sending the original text.
- Optional incoming auto-translation for new messages from other users in explicitly enabled, currently visible conversations.
- Batch selection for up to 25 messages already loaded in the current conversation, without fetching chat history.
- Local history (100 entries), saved message translations (300), and an in-memory result cache (200).
- Protection for code, links, mentions, Discord emoji syntax, and selected terms. A response that damages a protected marker is rejected.
- Serialized requests, deduplication, a bounded queue, timeouts, HTTP 429 cooldowns, and cancellation when stopped or cleared.

## Differences from the old Rain plugin

This beta does not yet provide complete feature parity:

- Draft translation uses **Use in draft** in the panel; it does not replace Send with a two-tap control.
- The composer button has one position. Gift and other Discord buttons are left alone.
- Incoming auto-translation only runs in the visible conversation.
- Batch translation uses loaded messages without server-side history pagination.
- History supports copying/deleting; jumping to the original message is not implemented.
- There is no automatic DeepL-to-Google fallback. Choose the provider explicitly.
- The cache stays in memory. History and message translations can persist according to the settings.
- Chat translations use plain text nodes. Protected syntax is preserved as text, but rendering it as mentions, emoji, or Markdown within the translated section is not implemented. Panel colors work; chat colors depend on the renderer's support for node styling.

## Verification and limitations

Verified: strict TypeScript, compilation with the official Valenced compiler source, ZIP structure, repository index generation, artifact hashes, and automated engine/lifecycle tests in a simulated runtime.

Not device-tested: private Discord module discovery, composer placement, long-press menu structure, draft updates, and native message-row regeneration. Simulated tests cannot prove these integrations work on the target Discord build. No on-device FPS, startup, or memory benchmarks have been measured.

The plugin has no Kotlin, Java, Objective-C, or Android-specific paths. It is designed for the shared JavaScript/React Native runtime. iOS compatibility still requires testing.

Google uses an unofficial endpoint and may rate-limit or reject requests. DeepL has account-specific quotas and possible costs. Automated verification does not send live translation requests. Providers receive the text surrounding protected markers. The DeepL key and translation history are stored locally without plugin-specific encryption.

## Build from source

Use Node 24, or at least Node 22.18. From the `QT` folder:

```sh
npm ci --legacy-peer-deps
npm run check
npm test
```

`npm test` rebuilds the plugin before running the tests. The build creates:

- `build/quick-translate.zip` and `Quick-Translate-Valenced-<version>.zip`;
- `index.js`, the compiled script;
- `index.json`, the repository index, including ZIP sizes and SHA-256 hashes.

Keep previous versioned ZIPs available when publishing. Commit the rebuilt script, new ZIP, manifest, and generated index together. Builds use the official `generateIndex` function, rather than maintaining a handwritten repository schema.

The vendored official compiler and index generator are from Valenced plugin CLI commit `9ea9f9bfc91319e2b18c6b1c9ac0b993f8600c1d`, under the included GPL license. Valenced types are pinned to commit `c67dd726d1ec28b38d8ac93862fdd3b6029b1d29`.

References: [Valenced plugin documentation](https://valenced.app/docs/plugin-development/) and [community plugins](https://github.com/Valenced/valenced-community-plugins).

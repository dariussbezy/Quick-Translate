# Quick Translate for Valenced — 2.0.0-beta6

Beta4 restores the uploaded Quick Translate 1.0.8 design and behavior. It adapts that source for Valenced instead of using the simplified interface from beta1–beta3. All labels remain in English.

Source, compiled files, and repository updates are published under `QT` on `main`.

## Added and fixed in beta6

- Reduced the original-to-translation gap from two newline nodes to one.
- Color spans now carry the native username-link context and the exact processed color selected in the palette. Existing messages are regenerated when the color changes.
- The translation panel attaches drag handlers to the current responder; dragging the handle down dismisses it. The close button uses centered vector strokes instead of a font glyph.
- With a saved DeepL key, completion notifications name the provider actually used. A DeepL failure followed by Google fallback is labeled **Translated with Google Translate (DeepL fallback)**. Without a key, the completion message is simply **Translated**. Background translations stay silent; manual and bulk completion notices follow the preference.
- Bulk selection fetches 30 messages directly from Discord's page response, instead of relying on the smaller UI cache. Reaching the bottom requests the next 30. Only messages with translatable text are listed.
- New **Auto-detect overrides → Word language rules** settings allow adding, editing, and removing up to 100 word/phrase-to-source-language rules.

### Word language rules

For example, add **Salut** and select **Romanian**. In Auto-detect mode, that whole word is translated using Romanian even inside a sentence. The rest of the sentence still uses Auto-detect. Matches ignore case, longer phrases take precedence, and links/code/mentions are protected. An explicitly selected source language overrides these rules. Words marked **Keep words unchanged** remain unchanged.

Matched words can require additional provider requests on first use. Results are cached in memory. Word lookups are not added as separate history entries. When DeepL falls back, the message is retried consistently with Google rather than mixing providers invisibly.

## Fixed in beta5

- Chat translations now recognize Discord's current `type` field and explicitly mark native rows for rebinding. Removing a translation also marks the row changed, without editing the underlying message or toggling message flags.
- Translation color settings and preset rows show swatches/names without hex codes.
- The incoming-language setting is now **Quick translate messages to**, with its existing icon retained.
- The bulk selection's seed message is selected immediately. Enabled/disabled opacity is applied to the normal button container rather than the animated view, preventing a stale dimmed appearance.

## Install or update

Repository URL:

```text
https://raw.githubusercontent.com/dariussbezy/Quick-Translate/refs/heads/main/QT/index.json
```

In Valenced repository settings, add this URL. Open **Plugins → +** to install Quick Translate, then enable it and reload Discord. If it is already installed from this repository, use **Check for updates**, install **2.0.0-beta6**, and reload.

The plugin ID is still `dariuss.quick-translate`. You do not need to uninstall or clear your settings. Preferences and compatible history from previous Valenced betas are retained. If you previously added the branch-based URL, replace that repository entry with the main URL above.

[Direct beta6 ZIP](https://github.com/dariussbezy/Quick-Translate/raw/refs/heads/main/QT/Quick-Translate-Valenced-2.0.0-beta6.zip) is also available for **Install from file**.

Target: **Valenced app 1.3.0, Plugin API 1.0.0, Discord 352.6 Alpha**. App and API version numbers are different; the manifest correctly declares Plugin API `>=1 <2`.

## Original design restored

The original custom design kit is retained, including:

- Hero card, colored icon tiles, grouped settings cards, row spacing, switches, inputs, color picker, and quick guide.
- Light and dark palettes and original animations.
- The compact composer icon and its highlighted draft mode, with both button positions.
- The animated translation panel, backdrop, swipe-to-dismiss handle, language pages, favorite-language chips, and confirmation controls.
- The bulk-selection modal, history cards, and channel/DM selection screens.

## Original behaviors restored

- Google Translate and DeepL, including Free API keys and the original Google fallback for non-rate-limit DeepL failures.
- Tap the composer icon to arm/disarm translation; hold it for the original language panel.
- With **Translate before sending** enabled, the send area becomes Translate. Translate the draft first, then send. Original-draft restoration is available from the panel.
- Translate once, restore the usual language afterward, set a permanent language for a chat, keep translation armed, or translate the next message only.
- Source and target languages per chat, quick languages, and protected words.
- Original message menu actions: translate, show original, translate to another language, bulk translate, and copy translation.
- Immersive/replacement display, selected translation color, custom emoji rendering, and optional source-language labels.
- Automatic incoming translation for explicitly selected channels and DMs, including selected background conversations.
- Bulk selection with search, select/deselect all, and loading older messages in pages of 30.
- Searchable history with copy, delete, jump to message, and comparison using the other provider.
- Persistent history, result cache, saved message translations, and their clearing controls.

## Valenced adaptation and fixes

`src/original.js` contains the adapted original behavior and UI. `src/valenced.tsx` isolates module discovery, patcher signatures, event subscriptions, settings routes, clipboard, toasts, and request cancellation. `src/settings-store.ts` binds the original reactive settings contract to Valenced JSON storage.

The adaptation also prevents shared message/React-tree mutation, preserves the method receiver and send arguments, avoids overwriting a draft after its conversation changes, stops pending requests when disabled, and keeps HTTP 429 cooldown errors from triggering a second provider. Settings writes are serialized and coalesced.

The obsolete Rain global bridge and simplified beta1–beta3 implementation are not included in the installed beta4 code. Historical ZIPs remain available as previous releases. The original source fixture under `tests/fixtures/` is for regression tests only and is not bundled into the plugin.

## Verification and limits

Automated checks compare the adapted rendered layouts with the uploaded original in light and dark themes, including settings subpages, the bulk selector, and each page of the composer modal. Callback identities, the version footer, and the explicitly requested beta5/beta6 UI changes are normalized for comparison. This verifies component structure and style values; it is not an on-device screenshot or animation test.

Functional checks cover draft translation, message actions, sender arguments, original message preservation, provider fallback, rate limiting, cancellation, per-chat preferences, bulk history loading, history actions, background auto-translation, lifecycle cleanup, and the official compiled bundle's Valenced API paths. The repository index and ZIP checksums are also checked.

Discord's private module names and native rendering still require confirmation on the target device. iOS has not been tested. No on-device performance benchmark has been run.

Google uses an unofficial endpoint and may rate-limit or reject requests. DeepL has account-specific quotas and possible costs. Automated tests do not send text to live translation providers. API keys and history are stored locally without plugin-specific encryption. The original DeepL-to-Google fallback behavior is retained.

## Build

Use Node 24 (minimum 22.18). From `QT`:

```sh
npm ci --legacy-peer-deps
npm run check
npm test
```

Tests rebuild the plugin first. The build produces `index.js`, the versioned plugin ZIP, `build/quick-translate.zip`, and `index.json` with artifact sizes and SHA-256 hashes. Publish these together. Previous versioned ZIPs must remain available for the generated index.

The official Valenced compiler and index generator are vendored from commit `9ea9f9bfc91319e2b18c6b1c9ac0b993f8600c1d` under the included GPL license. Valenced types are pinned to `c67dd726d1ec28b38d8ac93862fdd3b6029b1d29`.

References: [Valenced documentation](https://valenced.app/docs/plugin-development/) and [community plugins](https://github.com/Valenced/valenced-community-plugins).

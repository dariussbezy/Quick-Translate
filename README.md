# Quick Translate for Valenced

Translate Discord messages and drafts with Google Translate or DeepL, using the familiar Quick Translate interface.

## Features

- **Translate messages** from their long-press menu, then restore the original whenever you want.
- **Translate drafts** from the chat bar. Tap the Translate icon to activate it; hold it for languages, one-time translation and draft options.
- **Translate before sending** replaces Send with Translate while active. Translate your draft first, then tap again to send.
- **Quick languages** let you pin up to six favorites, with a usual target language for each chat.
- **Google Translate and DeepL**, with automatic Google fallback if DeepL fails. With a DeepL key configured, the completion notification names the service actually used.
- **Immersive translation** displays translations below the original, with a selectable color and optional source-language label.
- **Bulk translate** loads messages in pages of 30. Scroll down to load the next page and choose the messages to translate.
- **Automatic incoming translation** for selected channels and DMs.
- **Word language rules** correct Auto-detect for individual words or phrases, including matches inside sentences. New rules start without a selected language.
- **Protected words** preserve names and terms exactly as written.
- **Local translation history** supports copying, jumping to the original message and comparing providers.
- **Chat bar options** place Translate next to + or Send and optionally hide Gift.

## Installation

In Valenced, open **Plugins → Advanced → Repository URL**, paste this address and add the repository:

```text
https://raw.githubusercontent.com/dariussbezy/Quick-Translate/refs/heads/main/QT/index.json
```

Find **Quick Translate**, install it and enable it. Open the plugin's settings to choose your languages and translation service.

Already installed? Check for plugin updates and restart Discord after updating. The repository URL stays the same.

When **Next to the Send button** is selected, hold the Translate icon and tap **Turn off Translate** to disable translation. That action stays below the scrolling content in the draft menu. Close the menu with **X** or by tapping outside it.

## Privacy

Translation sends the text being translated to the selected provider. DeepL requires your own API key; Google Translate does not. If DeepL fails, the plugin can send that text to Google as a fallback. Automatic translation processes incoming text in the channels and DMs you select.

Settings, saved translations, history and the DeepL key are stored locally through Valenced. You can turn off history, clear saved translation data, and remove your API key in the plugin settings.

## Compatibility

Current release: **2.0.0-beta7**, targeting **Valenced 1.3.0 / Discord 352.6 alpha**. Other Discord versions may change the internal message and composer interfaces.

The plugin uses JavaScript and React Native without custom Kotlin or Objective-C code. iOS support still needs verification when Valenced for iOS becomes available.

## Building from source

All plugin source and release files are in [`QT`](QT). Use Node.js 24 and npm:

```sh
cd QT
npm ci --legacy-peer-deps
npm run check
npm run build
```

The build downloads and verifies a pinned revision of the official Valenced compiler into the ignored `build/` directory. Internet access is needed for the first build. In an environment with an HTTP proxy, use `NODE_USE_ENV_PROXY=1 npm run build`.

The installable ZIP contains only `manifest.json` and `index.js`. Files in `src/` are the editable source; the package and build configuration are only needed for rebuilding. The repository keeps the current release ZIP. Previous versions remain in Git history.

## License

[GPL-3.0-or-later](QT/LICENSE).

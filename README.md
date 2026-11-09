# Quick Translate for Valenced

Translate Discord messages and drafts with Google Translate or DeepL, using the familiar Quick Translate interface. Current version: **1.0.0-beta**.

## Features

- **Translate messages** from their long-press menu, then restore the original whenever you want.
- **Translate drafts** from the chat bar. Tap the Translate icon to activate it; hold it for languages, one-time translation and draft options.
- **Translate before sending** replaces Send with Translate while active. Translate your draft first, then tap again to send.
- **Quick languages** let you pin up to six favorites, with a usual target language for each chat.
- **Google Translate and DeepL**, with automatic Google fallback if DeepL fails. With a DeepL key configured, the completion notification names the service actually used. When the source-language label is off, the notification also shows the detected language.
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

## Privacy

Translation sends the text being translated to the selected provider. DeepL requires your own API key; Google Translate does not. If DeepL fails, the plugin can send that text to Google as a fallback. Automatic translation processes incoming text in the channels and DMs you select.

Settings, saved translations, history and the DeepL key are stored locally through Valenced. You can turn off history, clear saved translation data, and remove your API key in the plugin settings.

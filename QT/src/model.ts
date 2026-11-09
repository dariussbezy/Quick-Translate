import type { Result, Options } from "./engine";
export const languages = [
  ["en", "English"],
  ["ro", "Română"],
  ["es", "Español"],
  ["fr", "Français"],
  ["de", "Deutsch"],
  ["it", "Italiano"],
  ["pt", "Português"],
  ["ru", "Русский"],
  ["uk", "Українська"],
  ["pl", "Polski"],
  ["nl", "Nederlands"],
  ["tr", "Türkçe"],
  ["ar", "العربية"],
  ["he", "עברית"],
  ["hi", "हिन्दी"],
  ["ja", "日本語"],
  ["ko", "한국어"],
  ["zh-CN", "Chinese (Simplified)"],
  ["zh-TW", "Chinese (Traditional)"],
  ["id", "Indonesian"],
  ["th", "Thai"],
  ["vi", "Vietnamese"],
  ["sv", "Swedish"],
  ["da", "Danish"],
  ["no", "Norwegian"],
  ["fi", "Finnish"],
  ["cs", "Czech"],
  ["sk", "Slovak"],
  ["hu", "Hungarian"],
  ["el", "Greek"],
  ["bg", "Bulgarian"],
  ["sr", "Serbian"],
  ["hr", "Croatian"],
  ["sl", "Slovenian"],
  ["lt", "Lithuanian"],
  ["lv", "Latvian"],
  ["et", "Estonian"],
  ["fa", "Persian"],
  ["bn", "Bengali"],
  ["ur", "Urdu"],
  ["ms", "Malay"],
  ["ta", "Tamil"],
  ["te", "Telugu"],
  ["sw", "Swahili"],
  ["af", "Afrikaans"],
  ["ca", "Catalan"],
  ["tl", "Filipino"],
  ["is", "Icelandic"],
  ["ga", "Irish"],
  ["cy", "Welsh"],
  ["sq", "Albanian"],
  ["mk", "Macedonian"],
  ["ka", "Georgian"],
  ["hy", "Armenian"],
  ["az", "Azerbaijani"],
  ["kk", "Kazakh"],
  ["uz", "Uzbek"],
  ["mn", "Mongolian"],
  ["ne", "Nepali"],
  ["si", "Sinhala"],
  ["my", "Myanmar"],
  ["km", "Khmer"],
  ["lo", "Lao"],
  ["la", "Latin"],
  ["eo", "Esperanto"],
];
export interface Message {
  id: string;
  channel_id: string;
  content: string;
  author?: { id: string };
}
export interface Entry extends Result {
  original: string;
  target: string;
  channelId: string;
  messageId?: string;
  time: number;
}
export interface Settings {
  provider: Options["provider"];
  deeplApiKey: string;
  targetIn: string;
  targetOut: string;
  sourceOut: string;
  immersive: boolean;
  translationColor: string;
  showSourceLanguage: boolean;
  showButton: boolean;
  autoOutgoing: boolean;
  autoChannelIds: string[];
  rememberLanguagesPerChat: boolean;
  chatLanguages: Record<
    string,
    { targetIn: string; targetOut: string; sourceOut: string }
  >;
  protectedWords: string[];
  favLangs: string[];
  saveHistory: boolean;
  history: Entry[];
  keepMessageTranslations: boolean;
  saved: Entry[];
}
export const defaults: Settings = {
  provider: "google",
  deeplApiKey: "",
  targetIn: "en",
  targetOut: "en",
  sourceOut: "auto",
  immersive: true,
  translationColor: "#8EA1FF",
  showSourceLanguage: false,
  showButton: true,
  autoOutgoing: false,
  autoChannelIds: [],
  rememberLanguagesPerChat: true,
  chatLanguages: {},
  protectedWords: [],
  favLangs: ["en", "es", "fr", "de", "ro", "ru"],
  saveHistory: true,
  history: [],
  keepMessageTranslations: true,
  saved: [],
};
export const label = (code: string) =>
  languages.find((x) => x[0] === code)?.[1] ?? code;

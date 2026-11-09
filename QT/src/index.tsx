import { cloneElement, isValidElement } from "react";
import type { ReactNode, ReactElement } from "react";
import { View } from "react-native";
import { getModules } from "@valenced/modules/finders";
import {
  createFilterGenerator,
  withName,
  withProps,
} from "@valenced/modules/finders/filters";
import { after, before, instead } from "@valenced/patcher";
import { Stores, onFluxEventDispatched } from "@valenced/discord/flux";
import { ActionSheetActionCreators } from "@valenced/discord/actions";
import { Runtime } from "./runtime";
import type { Storage } from "./runtime";
import type { PluginApi } from "@valenced/plugins/types";
import { defaults } from "./model";
import type { Settings, Message } from "./model";
import { Action, openTranslator, Preferences } from "./ui";

// Discord's private module boundaries are intentionally isolated here.
// Shapes are validated at runtime; API internals may change with Discord releases.
type Module = Record<string, any>;
let runtime: Runtime | undefined;
const namedComponent = createFilterGenerator<[string]>(
  ([name], _, exports) =>
    typeof exports?.type === "function" && exports.type.displayName === name,
  ([name]) => `dariuss.quick-translate.component.v1(${name})`,
);
function rewrite(
  tree: ReactNode,
  inject: (element: ReactElement<Module>) => ReactNode,
  depth = 0,
): ReactNode {
  if (depth > 24) return tree;
  if (Array.isArray(tree))
    return tree.map((child) => rewrite(child, inject, depth + 1));
  if (!isValidElement<Module>(tree)) return tree;
  const changed = inject(tree);
  if (changed !== tree) return changed;
  return tree.props.children
    ? cloneElement(tree, {}, rewrite(tree.props.children, inject, depth + 1))
    : tree;
}
export default plugin<{ jsonStorage: Settings }>({
  jsonStorage: { load: true, default: defaults },
  async start({ cleanup, jsonStorage, logger, plugin }) {
    await jsonStorage.get();
    const rt = new Runtime(jsonStorage as unknown as Storage);
    runtime = rt;
    rt.restore();
    const selected = Stores.SelectedChannelStore as unknown as {
      getChannelId(): string;
    };
    const messages = Stores.MessageStore as unknown as {
      getMessage(channel: string, id: string): Message | undefined;
      getMessages(
        channel: string,
      ): { toArray?: () => Message[]; _array?: Message[] } | undefined;
    };
    rt.loadedMessages = () => {
      const collection = messages.getMessages?.(rt.channel());
      const list = collection?.toArray?.() ?? collection?._array ?? [];
      return list
        .filter((m) => typeof m.content === "string" && m.content.trim())
        .slice(-25);
    };
    rt.channel = () => selected.getChannelId() ?? "";
    let dispatcher: Module | undefined,
      draftStore: Module | undefined,
      draftActions: Module | undefined,
      inputApi: Module | undefined;
    cleanup(() => {
      rt.dispose();
      if (runtime === rt) runtime = undefined;
    });
    rt.refresh = (channelId, id) => {
      const message = messages.getMessage(channelId, id);
      // Ask Discord to regenerate its own row, keeping its flags and message text intact.
      if (message && dispatcher)
        dispatcher.dispatch({
          type: "MESSAGE_UPDATE",
          message: { id, channel_id: channelId, content: message.content },
        });
    };
    const watch = (filter: any, callback: (mod: Module) => void) =>
      cleanup(
        getModules(filter, (mod) => {
          if (!rt.alive) return;
          try {
            callback(mod as Module);
          } catch (e) {
            logger.error("Quick Translate integration failed", e);
            plugin.reportError(e);
          }
        }),
      );
    watch(withProps("dispatch", "subscribe"), (mod) => {
      dispatcher = mod;
    });
    watch(withProps("getDraft", "getState"), (mod) => {
      draftStore = mod;
    });
    watch(withProps("saveDraft", "clearDraft"), (mod) => {
      draftActions = mod;
    });
    watch(withProps("getChatInputRef"), (mod) => {
      inputApi = mod;
    });
    const draft = {
      read: () => {
        const text = draftStore?.getDraft(rt.channel(), 0);
        return typeof text === "string" ? text : "";
      },
      write: (text: string) => {
        if (!rt.alive) throw new Error("Plugin stopped");
        const id = rt.channel(),
          ref = inputApi?.getChatInputRef(id, 0);
        if (typeof ref?.setText === "function") {
          ref.setText(text);
          draftActions?.saveDraft(id, text, 0);
          return;
        }
        if (typeof draftActions?.saveDraft === "function") {
          draftActions.saveDraft(id, text, 0);
          return;
        }
        throw new Error(
          "Composer API unavailable on this Discord version. Copy the translation instead.",
        );
      },
    };
    rt.open = () => openTranslator(rt, draft);
    // One bounded lookup, deferred until Discord initializes the composer.
    watch(namedComponent("ChatInputActions"), (mod) => {
      cleanup(
        after(
          mod as Module & { type: (...args: any[]) => ReactNode },
          "type",
          (tree: ReactNode) => (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              {tree}
              <Composer rt={rt} open={() => openTranslator(rt, draft)} />
            </View>
          ),
        ),
      );
    });
    watch(withName("RowManager"), (mod) => {
      const target =
        typeof mod?.prototype?.generate === "function"
          ? mod.prototype
          : mod.default?.prototype;
      if (typeof target?.generate !== "function")
        throw new Error("RowManager.generate unavailable");
      cleanup(
        after(target, "generate", (row: Module) => {
          if (!row?.message) return row;
          const m = row.message,
            e = rt.entries.get(`${m.channelId ?? m.channel_id}:${m.id}`);
          const stored = messages.getMessage(e?.channelId ?? "", String(m.id));
          if (!e || stored?.content !== e.original) return row;
          const translated = {
            type: "text",
            content:
              (rt.settings.showSourceLanguage
                ? `${e.source} → ${e.target}\n`
                : "") + e.text,
            style: { color: rt.settings.translationColor },
          };
          const original = Array.isArray(m.content)
            ? m.content
            : [{ type: "text", content: m.content ?? "" }];
          return {
            ...row,
            message: {
              ...m,
              content: rt.settings.immersive
                ? [...original, { type: "text", content: "\n\n" }, translated]
                : [translated],
            },
          };
        }),
      );
    });
    cleanup(
      before(ActionSheetActionCreators, "openLazy", (args) => {
        const [promise, key, context] = args as unknown as [
          Promise<{ default: (...args: any[]) => ReactNode }>,
          string,
          { message?: Message },
        ];
        if (
          key !== "MessageLongPressActionSheet" ||
          !context?.message?.content ||
          !promise?.then
        )
          return args;
        const message = context.message;
        // Wrap only this sheet invocation; never attach unbounded global hooks on long-press.
        args[0] = promise.then((module) => {
          if (!rt.alive) return module;
          return {
            ...module,
            default: function (...props: any[]) {
              let inserted = false;
              return rewrite(module.default(...props), (element) => {
                if (inserted || !Array.isArray(element.props.children))
                  return element;
                const children = element.props.children;
                const template = children.find(
                  (child: any) =>
                    isValidElement<Module>(child) &&
                    typeof child.props.onPress === "function" &&
                    typeof child.props.label === "string",
                );
                if (!template) return element;
                inserted = true;
                const action = cloneElement(template, {
                  key: "quick-translate",
                  label: "Translate",
                  onPress: () => {
                    ActionSheetActionCreators.hideActionSheet(key);
                    openTranslator(rt, draft, message);
                  },
                });
                return cloneElement(element, {}, [action, ...children]);
              });
            },
          };
        }) as (typeof args)[0];
        return args;
      }),
    );
    // Manual translation stays available in settings even if a private Discord hook changes.
    watch(withProps("sendMessage", "receiveMessage"), (mod) => {
      cleanup(
        instead(
          mod as Module & { sendMessage: (...args: any[]) => any },
          "sendMessage",
          function (args: any[], original: any) {
            if (!rt.settings.autoOutgoing || !args[1]?.content?.trim())
              return Reflect.apply(original, this, args);
            const channel = String(args[0]),
              content = String(args[1].content),
              options = rt.options(false);
            const perChat = rt.settings.rememberLanguagesPerChat
              ? rt.settings.chatLanguages[channel]
              : undefined;
            if (perChat)
              Object.assign(options, {
                target: perChat.targetOut,
                source: perChat.sourceOut,
              });
            return rt.engine.translate(content, options).then((result) => {
              if (!rt.alive)
                throw new Error("Translation cancelled; message was not sent");
              const next = [...args];
              next[1] = { ...args[1], content: result.text };
              return Reflect.apply(original, this, next);
            });
          },
        ),
      );
    });
    cleanup(
      onFluxEventDispatched("MESSAGE_CREATE", (payload) => {
        const message = (payload as Module).message as Message | undefined;
        if (
          message?.content &&
          message.channel_id === rt.channel() &&
          rt.settings.autoChannelIds.includes(message.channel_id)
        ) {
          const current = (
            Stores.UserStore as unknown as {
              getCurrentUser(): { id: string } | undefined;
            }
          ).getCurrentUser();
          if (message.author?.id !== current?.id)
            void rt.translate(message.content, true, message).catch((e) => {
              if (rt.alive) logger.warn("Automatic translation skipped", e);
            });
        }
        return payload;
      }),
    );
  },
  SettingsComponent({ api }: { api: PluginApi<{ jsonStorage: Settings }> }) {
    const settings = api.jsonStorage.use();
    if (!runtime || !settings) return null;
    return <Preferences runtime={runtime} settings={settings} />;
  },
});
function Composer({ rt, open }: { rt: Runtime; open: () => void }) {
  // Storage hook only lives in our own component: no hooks injected into Discord.
  const storage = rt.storage as typeof rt.storage & {
    use(): Settings | undefined;
  };
  const settings = storage.use();
  return settings?.showButton ? <Action title="文" onPress={open} /> : null;
}

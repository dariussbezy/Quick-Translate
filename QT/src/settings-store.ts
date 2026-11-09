import { useSyncExternalStore } from "react";

type Settings = Record<string, any>;
export interface Persistence {
  set(value: Settings, replace?: boolean): Promise<unknown>;
}
export function createPluginStore(_id: string, defaults: Settings) {
  let state: Settings;
  let persistence: Persistence | undefined;
  let pending: Settings | undefined;
  let writes: Promise<void> = Promise.resolve();
  let scheduled = false;
  let errorHandler: (error: unknown) => void = () => {};
  const listeners = new Set<(state: Settings) => void>();
  const subscribe = (listener: (state: Settings) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const snapshot = () => state;
  const serializable = () => {
    const { _hasHydrated, updateSettings, ...data } = state;
    return data;
  };
  const emit = () => {
    for (const listener of listeners) listener(state);
  };
  const schedule = () => {
    if (!persistence) return;
    pending = serializable();
    if (scheduled) return;
    scheduled = true;
    writes = writes
      .then(async () => {
        scheduled = false;
        const data = pending;
        pending = undefined;
        const target = persistence;
        if (data && target) await target.set(data, true);
      })
      .catch((error) => errorHandler(error));
  };
  const updateSettings = (patch: Settings) => {
    state = { ...state, ...patch, updateSettings };
    emit();
    schedule();
  };
  state = { ...defaults, _hasHydrated: false, updateSettings };
  const useStore = Object.assign(
    function useStore() {
      return useSyncExternalStore(subscribe, snapshot, snapshot);
    },
    {
      defaults,
      getState: snapshot,
      subscribe,
      attach(
        data: Settings,
        storage: Persistence,
        onError: (error: unknown) => void,
      ) {
        errorHandler = onError;
        persistence = storage;
        // Preserve preferences saved by earlier Valenced betas when restoring the original schema.
        const converted = { ...data };
        if (!Array.isArray(data.historyEntries) && Array.isArray(data.history))
          converted.historyEntries = data.history.map((entry: Settings) => ({
            ...entry,
            translated: entry.text,
            source: entry.source,
            at: entry.time,
            id: [entry.channelId, entry.messageId, entry.time].join("|"),
          }));
        if (
          !Array.isArray(data.messageTranslations) &&
          Array.isArray(data.saved)
        )
          converted.messageTranslations = data.saved.map((entry: Settings) => ({
            ...entry,
            messageId: entry.messageId,
            translated: entry.text,
            at: entry.time,
            id: [entry.channelId, entry.messageId].join("|"),
          }));
        delete converted.history;
        delete converted.saved;
        delete converted.autoOutgoing;
        state = {
          ...defaults,
          ...converted,
          _hasHydrated: true,
          updateSettings,
        };
        emit();
      },
      async flush() {
        await writes;
      },
      async detach() {
        await writes;
        persistence = undefined;
        pending = undefined;
      },
    },
  );
  return { useStore };
}

import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type Status = 'pending' | 'active' | 'done' | 'interrupted' | 'error';

export interface Item {
  id: string;
  name: string;
  size: number;
  transferred: number;
  speed: number; // bytes/sec
  status: Status;
  direction: 'send' | 'receive';
  path?: string; // local path (received file or source file)
  finishedAt?: number;
}

interface State {
  items: Record<string, Item>;
  order: string[];
  history: Item[];
  info: string;
  setInfo: (s: string) => void;
  upsert: (p: Partial<Item> & { id: string }) => void;
  resetSession: () => void;
  loadHistory: () => Promise<void>;
  clearHistory: () => Promise<void>;
}

const KEY = 'sharekita.history.v1';
const TERMINAL: Status[] = ['done', 'interrupted', 'error'];

export const useStore = create<State>((set, get) => ({
  items: {},
  order: [],
  history: [],
  info: '',
  setInfo: (info) => set({ info }),

  upsert: (p) => {
    const prev = get().items[p.id];
    const next = { ...(prev ?? {}), ...p } as Item;
    if (p.status && TERMINAL.includes(p.status)) next.finishedAt = Date.now();
    const items = { ...get().items, [p.id]: next };
    const order = prev ? get().order : [...get().order, p.id];
    set({ items, order });

    if (p.status && TERMINAL.includes(p.status)) {
      const history = [next, ...get().history.filter((h) => h.id !== next.id)].slice(0, 200);
      set({ history });
      AsyncStorage.setItem(KEY, JSON.stringify(history)).catch(() => {});
    }
  },

  resetSession: () => set({ items: {}, order: [], info: '' }),

  loadHistory: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) set({ history: JSON.parse(raw) });
    } catch {}
  },

  clearHistory: async () => {
    set({ history: [] });
    await AsyncStorage.removeItem(KEY);
  },
}));

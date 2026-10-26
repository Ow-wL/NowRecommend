import type { Conditions } from './domain';

// Lab log (plans-music-ai.md §2): one entry per request round with both answers and the user's verdict.
// It stays in this browser, separate from the main store, and never feeds history or tastes.
const KEY = 'nowrecommend-lab-v1';
const LIMIT = 200;

export type LabSide = 'pool' | 'free';
export type LabSong = { title: string; artist: string; tasteReason: string; contextReason: string; confidence?: 'high' | 'medium' | 'low' };
export type LabMark = 'missing' | 'bad' | 'good';
export type LabAnswer = { songs: LabSong[]; ms: number; status: 'ok' | 'failed' | 'fallback'; detail?: string; model?: string };
export type LabVote = 'pool' | 'same' | 'free';
export type LabEntry = {
  id: string; date: string; raw: string; conditions: Conditions; likedText: string[]; round: number; sides?: LabSide[];
  pool?: LabAnswer; free?: LabAnswer; vote?: LabVote; note?: string; marks: Record<string, LabMark>;
};

export const markKey = (side: LabSide, song: { title: string; artist: string }) => `${side}:${song.title} - ${song.artist}`;

const validEntry = (v: any): v is LabEntry => !!v && typeof v.id === 'string' && typeof v.date === 'string' && typeof v.raw === 'string'
  && !!v.conditions && Array.isArray(v.likedText) && Number.isInteger(v.round) && !!v.marks && typeof v.marks === 'object';

export function readLab(storage: Pick<Storage, 'getItem'> = localStorage): LabEntry[] {
  try {
    const value = JSON.parse(storage.getItem(KEY) || '[]');
    return Array.isArray(value) ? value.filter(validEntry) : [];
  } catch { return []; }
}

export function writeLab(entries: LabEntry[], storage: Pick<Storage, 'setItem'> = localStorage): boolean {
  try { storage.setItem(KEY, JSON.stringify(entries.slice(0, LIMIT))); return true; } catch { return false; }
}

export function upsertEntry(entries: LabEntry[], entry: LabEntry): LabEntry[] {
  return [entry, ...entries.filter(e => e.id !== entry.id)].slice(0, LIMIT);
}

export type LabTally = {
  votes: Record<LabVote, number>; rounds: number;
  sides: Record<LabSide, { answered: number; failed: number; songs: number; missing: number; bad: number; good: number; avgMs: number | null }>;
};

export function tally(entries: LabEntry[]): LabTally {
  const votes: Record<LabVote, number> = { pool: 0, same: 0, free: 0 };
  const side = () => ({ answered: 0, failed: 0, songs: 0, missing: 0, bad: 0, good: 0, avgMs: null as number | null, total: 0 });
  const sides = { pool: side(), free: side() };
  for (const entry of entries) {
    if (entry.vote) votes[entry.vote]++;
    for (const name of ['pool', 'free'] as const) {
      const answer = entry[name], s = sides[name];
      if (!answer) continue;
      if (answer.status === 'failed') s.failed++; else s.answered++;
      s.songs += answer.songs.length;
      s.total += answer.ms;
    }
    for (const [key, mark] of Object.entries(entry.marks)) {
      const name = key.startsWith('pool:') ? 'pool' : key.startsWith('free:') ? 'free' : null;
      if (name) sides[name][mark]++;
    }
  }
  const done = (s: ReturnType<typeof side>) => {
    const { total, ...rest } = s;
    const calls = s.answered + s.failed;
    return { ...rest, avgMs: calls ? Math.round(total / calls) : null };
  };
  return { votes, rounds: entries.length, sides: { pool: done(sides.pool), free: done(sides.free) } };
}

export function downloadLab(entries: LabEntry[]) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ app: 'nowrecommend-lab', version: 1, exportedAt: new Date().toISOString(), entries }, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `nowrecommend-lab-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

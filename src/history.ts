import type { Feedback, HistoryEntry, Recommendation, Session } from './domain';
import { CATALOG_META } from './data';
export function recordRound(history: HistoryEntry[], session: Session, results: Recommendation[], feedback: Feedback[] = [], date = new Date().toISOString()): HistoryEntry[] {
  if (!session.id || !session.roundId) return history;
  const existing = history.find(h => h.id === session.id);
  if (existing?.rounds.some(r => r.id === session.roundId)) return history;
  const round = { id: session.roundId, date, raw: session.raw, conditions: structuredClone(session.conditions), results: structuredClone(results), feedback: structuredClone(feedback), excludedIds: [...session.excludedIds], catalogVersion: CATALOG_META.version };
  const rounds = [...(existing?.rounds || []), round];
  const trimmed = Math.max(0, rounds.length - 10);
  const entry: HistoryEntry = { ...(existing || {}), id: session.id, date: existing?.date || date, category: session.category, raw: session.raw || '직접 선택한 조건', conditions: structuredClone(session.conditions), resultIds: results.map(r=>r.item.id), rounds: rounds.slice(-10), trimmedRounds: (existing?.trimmedRounds || 0) + trimmed };
  return [entry, ...history.filter(h => h.id !== entry.id)].slice(0,50);
}
export function selectResult(entry: HistoryEntry, result: Recommendation, roundId: string): HistoryEntry {
  if (entry.selected?.result.item.id === result.item.id && entry.selected.roundId === roundId) return entry;
  return { ...entry, selected: { result: structuredClone(result), roundId, date: new Date().toISOString() } };
}

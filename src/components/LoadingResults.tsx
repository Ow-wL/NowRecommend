import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import type { Category } from '../data';

const STEPS = ['문장 해석', '후보 찾기', 'AI가 고르기'] as const;
const STAGE_TEXT = { parsing: '문장을 해석하고 있어요', search: '조건에 맞는 후보를 찾고 있어요', rank: 'AI가 후보를 고르고 있어요' } as const;

/** What the person sees while the server works: which step is running, and the shape of the cards that are coming.
 * The server does not report its progress, so the third step is assumed after a moment: finding candidates is quick, ranking is not. */
export function LoadingResults({ category, stage }: { category: Category; stage: 'parsing' | 'busy' }) {
  const [late, setLate] = useState(false);
  useEffect(() => { if (stage !== 'busy') { setLate(false); return; } const timer = setTimeout(() => setLate(true), 1500); return () => clearTimeout(timer); }, [stage]);
  const current = stage === 'parsing' ? 0 : late ? 2 : 1;
  const count = category === 'food' ? 3 : 5;
  return <section className={`loading-results ${category}`} aria-busy="true">
    <p className="loading-stage" role="status"><span className="spinner" />{STAGE_TEXT[current === 0 ? 'parsing' : current === 1 ? 'search' : 'rank']}</p>
    <ol className="loading-steps" aria-hidden="true">{STEPS.map((step, n) => <li key={step} className={n < current ? 'done' : n === current ? 'active' : ''}>{n < current && <Check size={13} strokeWidth={3} />}{step}</li>)}</ol>
    <div className={`skeleton-grid ${category}`} aria-hidden="true">{Array.from({ length: count }, (_, n) => <div className="skeleton-card" key={n} style={{ animationDelay: `${n * 60}ms` }}><span className="skeleton-art" /><span className="skeleton-line" /><span className="skeleton-line short" /></div>)}</div>
  </section>;
}

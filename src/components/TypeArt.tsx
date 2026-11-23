import type { Category } from '../data';

// A small drawing of a taste type (2026-11-23), built from its four letters so every type gets its own scene:
//   food  S flame / M steam · H deep bowl / L flat plate · T heart / N sparkles · A one spoon / G many chopsticks
//   music E bouncing bars / C slow waves · V microphone / I piano keys · R vinyl / N new-release tag · F headphones / B speaker
// Motion is gentle and stops for people who ask for less (styles.css, prefers-reduced-motion). Decorative: the code and
// name next to it say the same in words.
export function TypeArt({ category, code }: { category: Category; code: string }) {
  const [a, b, c, d] = code.split('');
  return <svg className={`type-art ${category}`} viewBox="0 0 240 180" aria-hidden="true" focusable="false">
    <circle className="ta-halo" cx="120" cy="92" r="78" />
    {category === 'food' ? <>
      {/* above the dish: flame or steam */}
      {a === 'S' ? <g className="ta-flame"><path d="M120 26c10 14 20 22 16 38a16 16 0 0 1-32 0c-2-10 6-16 8-26 4 6 6 10 8 12 2-8 0-16 0-24Z" /><path className="ta-flame-core" d="M120 48c5 7 8 11 6 18a7 7 0 0 1-14 0c0-5 4-8 8-18Z" /></g>
        : <g className="ta-steam"><path d="M100 64c-8-10 8-16 0-28" /><path d="M120 60c-8-10 8-16 0-30" /><path d="M140 64c-8-10 8-16 0-28" /></g>}
      {/* the dish: deep bowl or flat plate */}
      {b === 'H' ? <g className="ta-dish"><path className="ta-food" d="M74 92c6-16 86-16 92 0Z" /><path className="ta-bowl" d="M62 92h116c0 32-24 50-58 50s-58-18-58-50Z" /><rect className="ta-foot" x="100" y="140" width="40" height="8" rx="4" /></g>
        : <g className="ta-dish"><ellipse className="ta-bowl" cx="120" cy="124" rx="66" ry="16" /><ellipse className="ta-plate-in" cx="120" cy="121" rx="46" ry="9" /><path className="ta-leaf" d="M104 116c6-14 22-16 30-10-6 10-18 14-30 10Z" /><circle className="ta-food" cx="140" cy="114" r="7" /></g>}
      {/* a corner mark: the familiar (a heart) or the new (sparkles) */}
      {c === 'T' ? <path className="ta-mark ta-pulse" d="M196 40c-6-8-18-4-16 6 1 6 10 12 16 16 6-4 15-10 16-16 2-10-10-14-16-6Z" />
        : <g className="ta-mark ta-twinkle"><path d="M196 30l4 10 10 4-10 4-4 10-4-10-10-4 10-4Z" /><path className="ta-small" d="M178 62l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" /></g>}
      {/* who eats: one spoon, or chopsticks for many */}
      {d === 'A' ? <g className="ta-utensil"><ellipse cx="38" cy="112" rx="8" ry="11" /><rect x="35" y="120" width="6" height="40" rx="3" /></g>
        : <g className="ta-utensil ta-many"><rect x="24" y="96" width="5" height="62" rx="2.5" transform="rotate(-10 26 127)" /><rect x="36" y="96" width="5" height="62" rx="2.5" transform="rotate(-4 38 127)" /><rect x="196" y="100" width="5" height="58" rx="2.5" transform="rotate(8 198 129)" /><rect x="208" y="100" width="5" height="58" rx="2.5" transform="rotate(14 210 129)" /></g>}
    </> : <>
      {/* the centre: a spinning record, or a fresh release */}
      {c === 'R' ? <g className="ta-vinyl"><circle className="ta-disc" cx="120" cy="92" r="44" /><circle className="ta-groove" cx="120" cy="92" r="32" /><circle className="ta-groove" cx="120" cy="92" r="22" /><circle className="ta-label" cx="120" cy="92" r="12" /><circle className="ta-hole" cx="120" cy="92" r="3" /></g>
        : <g className="ta-release"><rect className="ta-disc" x="80" y="52" width="80" height="80" rx="18" /><path className="ta-label" d="M110 76v32l26-16Z" /><g className="ta-twinkle"><path className="ta-mark" d="M164 42l3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" /></g></g>}
      {/* left: a voice or the keys */}
      {b === 'V' ? <g className="ta-side ta-sway"><rect x="26" y="74" width="22" height="34" rx="11" /><path className="ta-line" d="M20 98c0 14 34 14 34 0M37 112v18M28 130h18" /></g>
        : <g className="ta-side"><rect className="ta-keys" x="16" y="96" width="52" height="40" rx="6" /><rect className="ta-black" x="25" y="96" width="7" height="22" rx="2" /><rect className="ta-black" x="38" y="96" width="7" height="22" rx="2" /><rect className="ta-black" x="51" y="96" width="7" height="22" rx="2" /></g>}
      {/* right: headphones to listen closely, or a speaker filling the room */}
      {d === 'F' ? <g className="ta-side"><path className="ta-line" d="M184 104v-10a22 22 0 0 1 44 0v10" /><rect x="178" y="100" width="12" height="22" rx="6" /><rect x="222" y="100" width="12" height="22" rx="6" /></g>
        : <g className="ta-side"><rect x="186" y="88" width="34" height="48" rx="8" /><circle className="ta-hole" cx="203" cy="120" r="8" /><circle className="ta-hole" cx="203" cy="100" r="4" /><path className="ta-line ta-wave" d="M226 98c6 6 6 18 0 24" /></g>}
      {/* the floor: bouncing bars or a slow wave */}
      {a === 'E' ? <g className="ta-bars">{[0, 1, 2, 3, 4, 5, 6].map(n => <rect key={n} x={78 + n * 13} y="150" width="8" height="18" rx="4" style={{ animationDelay: `${n * 0.12}s` }} />)}</g>
        : <path className="ta-line ta-calm" d="M70 160c12-10 22-10 34 0s22 10 34 0 22-10 34 0" />}
    </>}
  </svg>;
}

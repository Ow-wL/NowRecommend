/** The home doors' pictures, drawn from plain circles so they need no photo: a plate, a record, and the two overlapping. */
export function DoorMark({ kind }: { kind: 'food' | 'music' | 'pair' }) {
  return <svg className="door-mark" viewBox="0 0 200 200" aria-hidden="true">
    {kind === 'food' && <>
      <circle cx="100" cy="100" r="92" fill="var(--card)" />
      <circle cx="100" cy="100" r="68" fill="var(--food)" />
      <path d="M66 86c6-24 34-34 56-24 18 8 30 26 24 46-6 22-22 38-46 36-16-1-24-10-34-18-12-10-4-26 0-40z" fill="#FFFBF7" />
      <circle cx="104" cy="102" r="19" fill="var(--sun)" />
      <g fill="var(--food-ink)"><rect x="142" y="6" width="7" height="104" rx="3.5" transform="rotate(24 145 58)" /><rect x="160" y="10" width="7" height="104" rx="3.5" transform="rotate(24 163 62)" /></g>
    </>}
    {kind === 'music' && <>
      <circle cx="100" cy="100" r="92" fill="var(--music)" />
      {[80, 68, 56].map(r => <circle key={r} cx="100" cy="100" r={r} fill="none" stroke="var(--card)" strokeOpacity=".55" strokeWidth="2" />)}
      <circle cx="100" cy="100" r="36" fill="var(--card)" />
      <circle cx="100" cy="100" r="7" fill="var(--music)" />
    </>}
    {kind === 'pair' && <>
      <circle cx="68" cy="100" r="62" fill="var(--food)" fillOpacity=".9" />
      <circle cx="132" cy="100" r="62" fill="var(--music)" fillOpacity=".82" />
    </>}
  </svg>;
}

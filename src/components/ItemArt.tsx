import { useState } from 'react';
import type { Category } from '../data';
import { mediaFor } from '../media';

type Art = { id?: string; category: Category; name: string; subtitle?: string };

// Solid cover colours as [background, text]. Text contrast is at least 4.5:1 on each.
const COVERS: [string, string][] = [['#14342B', '#F1E9D8'], ['#C9421E', '#FFFFFF'], ['#1C2B4A', '#E8EDF6'], ['#E9B44C', '#1A1408'], ['#EDE6D6', '#1A1A1A'], ['#3B1F1F', '#F4DCCF'], ['#0F5C5C', '#E6F5F2'], ['#161616', '#F4F4F4'], ['#B7C4A1', '#1B2412'], ['#F2C6B4', '#3A120A']];
const coverFor = (key: string) => { let hash = 0; for (const ch of key) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0; return COVERS[hash % COVERS.length]; };

/** Photo or album cover of an item. An item with no image, or whose image fails, gets a typeset cover: its title on one
 * solid colour. The title is drawn by CSS from data attributes so it is not repeated to screen readers or text search.
 * Decorative by default (the name is always written next to it); `label` gives it an accessible name. */
export function ItemArt({ item, size = 'card', label, className = '', eager = false }: { item: Art; size?: 'card' | 'thumb' | 'tile' | 'hero'; label?: string; className?: string; eager?: boolean }) {
  const media = item.id ? mediaFor(item.id) : undefined;
  const [failed, setFailed] = useState('');
  const image = media && failed !== media.image ? media.image : '';
  const [bg, fg] = coverFor(item.id || item.name);
  return <span className={`item-art ${item.category} ${size} ${image ? 'has-image' : 'generated'} ${className}`}
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {image ? <img src={image} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(image)} />
      : <span className="art-cover" data-title={item.name} data-sub={item.subtitle || ''} style={{ ['--cover-bg' as string]: bg, ['--cover-fg' as string]: fg }} />}
  </span>;
}

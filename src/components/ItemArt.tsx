import { useState } from 'react';
import { Headphones, Utensils } from 'lucide-react';
import type { Category } from '../data';
import { mediaFor } from '../media';

type Art = { id?: string; category: Category; name: string; subtitle?: string; color?: string };

/** Photo or album cover of an item; a generated cover when there is none or it fails to load (DESIGN.md v3 §3).
 * Decorative by default (the name is always written next to it); `label` gives it an accessible name. */
export function ItemArt({ item, size = 'card', label, className = '' }: { item: Art; size?: 'card' | 'thumb' | 'tile' | 'hero'; label?: string; className?: string }) {
  const media = item.id ? mediaFor(item.id) : undefined;
  const [failed, setFailed] = useState('');
  const image = media && failed !== media.image ? media.image : '';
  const tint = item.color || (item.category === 'food' ? '#f4e9d9' : '#e6dfef');
  return <div className={`item-art ${item.category} ${size} ${image ? 'has-image' : 'generated'} ${className}`} style={{ ['--art-tint' as string]: tint }}
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {image ? <img src={image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(image)} />
      : <span className="art-fallback">
        {item.category === 'food' ? <Utensils size={size === 'thumb' ? 18 : 28} /> : <Headphones size={size === 'thumb' ? 18 : 28} />}
        {size !== 'thumb' && <b>{item.name.slice(0, 1)}</b>}
      </span>}
  </div>;
}

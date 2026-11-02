import { useState } from 'react';
import { Music2, Utensils } from 'lucide-react';
import type { Category } from '../data';
import { mediaFor } from '../media';

type Art = { id?: string; category: Category; name: string; subtitle?: string };

/** Photo or album cover of an item. With no image, or a failed one, it is a plain tile with the category's icon: a song we
 * could not confirm must not look like a real album.
 * Decorative by default (the name is always written next to it); `label` gives it an accessible name. */
export function ItemArt({ item, size = 'card', label, className = '', eager = false }: { item: Art; size?: 'card' | 'thumb' | 'tile' | 'hero'; label?: string; className?: string; eager?: boolean }) {
  const media = item.id ? mediaFor(item.id) : undefined;
  const [failed, setFailed] = useState('');
  const image = media && failed !== media.image ? media.image : '';
  return <span className={`item-art ${item.category} ${size} ${image ? 'has-image' : 'generated'} ${className}`}
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {image ? <img src={image} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(image)} />
      : <span className="art-empty">{item.category === 'food' ? <Utensils size={22} /> : <Music2 size={22} />}</span>}
  </span>;
}

import { useEffect, useRef, useState } from 'react';
import { Music2, Utensils } from 'lucide-react';
import type { Category } from '../data';
import { mediaOf } from '../media';

type Art = { id?: string; parentId?: string; category: Category; name: string; subtitle?: string };

/** Photo or album cover of an item. With no image, or a failed one, it is a plain tile with the category's icon: a song we
 * could not confirm must not look like a real album. While a picture loads the same tinted tile stands in, and the picture
 * fades over it, so a slow network shows colour and shape instead of a blank box.
 * Decorative by default (the name is always written next to it); `label` gives it an accessible name. */
export function ItemArt({ item, size = 'card', label, className = '', eager = false }: { item: Art; size?: 'card' | 'thumb' | 'tile' | 'hero'; label?: string; className?: string; eager?: boolean }) {
  const media = mediaOf(item);
  const [failed, setFailed] = useState('');
  const [loaded, setLoaded] = useState('');
  const img = useRef<HTMLImageElement>(null);
  const image = media && failed !== media.image ? media.image : '';
  // A picture already in the browser's cache can be complete before the load handler is attached.
  useEffect(() => { if (image && img.current?.complete && img.current.naturalWidth > 0) setLoaded(image); }, [image]);
  const ready = !!image && loaded === image;
  return <span className={`item-art ${item.category} ${size} ${image ? 'has-image' : 'generated'}${ready ? ' loaded' : ''} ${className}`}
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {!ready && <span className="art-empty">{item.category === 'food' ? <Utensils size={22} /> : <Music2 size={22} />}</span>}
    {image && <img ref={img} src={image} alt="" loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} decoding="async" referrerPolicy="no-referrer" onLoad={() => setLoaded(image)} onError={() => setFailed(image)} />}
  </span>;
}

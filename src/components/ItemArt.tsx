import { useEffect, useRef, useState } from 'react';
import { Music2, Utensils } from 'lucide-react';
import type { Category } from '../data';
import { midImage, mediaOf, tileImage } from '../media';

type Art = { id?: string; parentId?: string; category: Category; name: string; subtitle?: string };

/** How wide a card and the big picture are drawn, so the browser can choose between the 720 and 960 pixel copies before
 *  layout. They follow styles.css: food results are one column up to 640px, two up to 1100px, then three (measured
 *  2026-11-26: 335 CSS px at 375, 354 at 768, 387 at 1440); the big picture is one column up to 899px. */
const SIZES: Record<'card' | 'hero', string> = {
  card: '(max-width: 640px) calc(100vw - 40px), (max-width: 1100px) calc(50vw - 30px), 390px',
  hero: '(max-width: 899px) calc(100vw - 40px), 560px',
};

/** Photo or album cover of an item. With no image, or a failed one, it is a plain tile with the category's icon: a song we
 * could not confirm must not look like a real album. While a picture loads the same tinted tile stands in, and the picture
 * fades over it, so a slow network shows colour and shape instead of a blank box.
 * Decorative by default (the name is always written next to it); `label` gives it an accessible name. */
export function ItemArt({ item, size = 'card', label, className = '', eager = false }: { item: Art; size?: 'card' | 'thumb' | 'tile' | 'hero'; label?: string; className?: string; eager?: boolean }) {
  const media = mediaOf(item);
  const [failed, setFailed] = useState('');
  const [fullOnly, setFullOnly] = useState('');  // the 720 copy failed: offer only the full photo before giving up
  const [loaded, setLoaded] = useState('');
  const img = useRef<HTMLImageElement>(null);
  // A thumbnail (34-72 CSS pixels) and a tile take the small copy; a card or the big picture offer the 720 copy beside
  // the full one and let the browser pick by its width and screen density (SIZES).
  const small = size === 'tile' || size === 'thumb';
  const picture = media && (small ? tileImage(media.image) : media.image);
  const image = picture && failed !== picture ? picture : '';
  const mid = image && !small && fullOnly !== image ? midImage(image) : undefined;
  // A picture already in the browser's cache can be complete before the load handler is attached.
  useEffect(() => { if (image && img.current?.complete && img.current.naturalWidth > 0) setLoaded(image); }, [image]);
  const ready = !!image && loaded === image;
  return <span className={`item-art ${item.category} ${size} ${image ? 'has-image' : 'generated'}${ready ? ' loaded' : ''} ${className}`}
    role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
    {!ready && <span className="art-empty">{item.category === 'food' ? <Utensils size={22} /> : <Music2 size={22} />}</span>}
    {image && <img ref={img} src={image} srcSet={mid ? `${mid} 720w, ${image} 960w` : undefined} sizes={mid ? SIZES[size as keyof typeof SIZES] : undefined} alt="" loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} decoding="async" referrerPolicy="no-referrer" onLoad={() => setLoaded(image)} onError={() => mid ? setFullOnly(image) : setFailed(image)} />}
  </span>;
}

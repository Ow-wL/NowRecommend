import { Pause, Play, VolumeX } from 'lucide-react';
import type { Item } from '../data';
import { togglePreview, usePreview } from '../preview';

const NEWS = { unavailable: '이 곡은 미리듣기를 제공하지 않아요', failed: '지금은 미리듣기를 불러올 수 없어요' };
/** A round play button on the cover: thirty seconds from Apple's preview, one song at a time. */
export function PreviewButton({ item, size = 'small' }: { item: Pick<Item, 'id' | 'category' | 'name'>; size?: 'small' | 'large' }) {
  const state = usePreview(item);
  const icon = size === 'large' ? 22 : 15;
  return <>
    <button type="button" className={`preview-button ${size} ${state}`} aria-pressed={state === 'playing'} onClick={() => void togglePreview(item)}
      aria-label={state === 'playing' ? `${item.name} 미리듣기 중지` : `${item.name} 30초 미리듣기`} title={state === 'unavailable' ? NEWS.unavailable : state === 'failed' ? NEWS.failed : '30초 미리듣기'}>
      {state === 'loading' ? <span className="spinner" /> : state === 'playing' ? <Pause size={icon} fill="currentColor" /> : state === 'unavailable' || state === 'failed' ? <VolumeX size={icon} /> : <Play size={icon} fill="currentColor" />}
    </button>
    <span className="sr-only" role="status">{state === 'unavailable' ? NEWS.unavailable : state === 'failed' ? NEWS.failed : ''}</span>
  </>;
}

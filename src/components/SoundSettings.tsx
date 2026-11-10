import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { useState, type CSSProperties } from 'react';
import { DEFAULT_PREVIEW_VOLUME, canSetVolume, setPreviewVolume, usePreviewVolume } from '../preview';

const percent = (value: number) => Math.round(value * 100);
/** Loudness of the thirty-second previews. Applies at once, even to a song that is playing, and stays in this browser. */
export function SoundSettings() {
  const volume = usePreviewVolume(), level = percent(volume);
  const Icon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const [fixed] = useState(() => !canSetVolume());  // asked once: it does not change while the page is open
  return <section className="sound-settings">
    <h3>미리듣기 소리</h3>
    <div className="volume-row">
      <Icon size={20} aria-hidden="true" />
      <label className="sr-only" htmlFor="preview-volume">미리듣기 볼륨</label>
      <input id="preview-volume" type="range" min={0} max={100} step={5} value={level} disabled={fixed}
        aria-valuetext={volume === 0 ? '음소거' : `${level}%`} aria-describedby="preview-volume-note"
        style={{ '--volume': `${level}%` } as CSSProperties}
        onChange={e => setPreviewVolume(Number(e.target.value) / 100)} />
      <output htmlFor="preview-volume" aria-hidden="true">{volume === 0 ? '음소거' : `${level}%`}</output>
    </div>
    <p className="small" id="preview-volume-note">{fixed ? '이 기기에서는 미리듣기 소리를 기기 볼륨 버튼으로 조절해요.' : '30초 미리듣기에만 적용돼요. 듣는 중에 바꿔도 바로 반영되고, 이 브라우저에 저장돼요.'}</p>
    {!fixed && volume !== DEFAULT_PREVIEW_VOLUME && <button type="button" className="text-button" onClick={() => setPreviewVolume(DEFAULT_PREVIEW_VOLUME)}>기본 볼륨({percent(DEFAULT_PREVIEW_VOLUME)}%)으로 되돌리기</button>}
  </section>;
}

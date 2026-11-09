import { useCallback, useEffect, useRef, useState } from 'react';

/** Speaking the situation instead of typing it, through the browser's own speech recognition (Web Speech API, ko-KR).
 * Nothing is sent by us: the browser does the listening. Where the API is missing the button is not shown. */
type Recognition = EventTarget & { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };
type RecognitionClass = new () => Recognition;
const recognitionClass = (): RecognitionClass | undefined => {
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass };
  return w.SpeechRecognition || w.webkitSpeechRecognition;
};
export const ERROR_TEXT: Record<string, string> = {
  'not-allowed': '마이크 사용이 허용되지 않았어요. 브라우저 설정에서 허용한 뒤 다시 눌러주세요.',
  'service-not-allowed': '이 브라우저에서는 음성 인식을 쓸 수 없어요.',
  'no-speech': '말소리를 듣지 못했어요. 다시 눌러 말해주세요.',
  'audio-capture': '마이크를 찾지 못했어요.',
  network: '음성 인식 서버에 연결하지 못했어요.',
};
export function useVoiceInput(onText: (text: string) => void, onError: (message: string) => void) {
  const [supported] = useState(() => typeof window !== 'undefined' && !!recognitionClass());
  const [listening, setListening] = useState(false), [interim, setInterim] = useState('');
  const current = useRef<Recognition | null>(null);
  const handlers = useRef({ onText, onError }); handlers.current = { onText, onError };
  const stop = useCallback(() => { current.current?.stop(); }, []);
  const start = useCallback(() => {
    const Klass = recognitionClass(); if (!Klass || current.current) return;
    const recognition = new Klass();
    recognition.lang = 'ko-KR'; recognition.interimResults = true; recognition.continuous = false;
    let heard = '';
    recognition.onresult = e => {
      let finalText = '', partial = '';
      for (let i = 0; i < e.results.length; i++) { const text = e.results[i][0]?.transcript || ''; if (e.results[i].isFinal) finalText += text; else partial += text; }
      if (finalText) { heard = finalText.trim(); setInterim(''); } else setInterim(partial.trim());
    };
    recognition.onerror = e => { if (e.error !== 'aborted') handlers.current.onError(ERROR_TEXT[e.error] || '음성 인식에 실패했어요.'); };
    recognition.onend = () => { current.current = null; setListening(false); setInterim(''); if (heard) handlers.current.onText(heard); };
    current.current = recognition; setListening(true); setInterim('');
    try { recognition.start(); } catch { current.current = null; setListening(false); handlers.current.onError('음성 인식을 시작하지 못했어요.'); }
  }, []);
  useEffect(() => () => current.current?.abort(), []);
  return { supported, listening, interim, start, stop };
}

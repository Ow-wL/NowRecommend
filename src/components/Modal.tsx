import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';

// The page behind is made inert once, by the first dialog that opens, and given back by the last one that closes. Two
// dialogs can be open at once (the health consent over a note being saved) and can close in the same instant; each
// restoring what it found would leave the page inert for good.
let openTraps = 0;
let restorePage = () => { /* nothing is held */ };

/** `over`: this dialog may open on top of another one. Its keys are then taken before the dialog underneath sees them,
 * so Escape closes one dialog and Tab stays in the one on top. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, onClose: () => void, enabled = true, backgroundSelector = '.appbar, .main-content, .tabbar, .action-bar, .skip-link', over = false) {
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    const previous = document.activeElement as HTMLElement | null;
    if (openTraps++ === 0) {
      const background = Array.from(document.querySelectorAll<HTMLElement>(backgroundSelector));
      const inert = background.map(n=>n.inert), overflow = document.body.style.overflow;
      background.forEach(n=>n.inert=true);
      document.body.style.overflow='hidden';
      restorePage = () => { background.forEach((n,i)=>n.inert=inert[i]); document.body.style.overflow=overflow; };
    }
    const controls = () => Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], select:not(:disabled), textarea:not(:disabled), summary') || []).filter(n=>n.getClientRects().length > 0);
    (ref.current?.querySelector<HTMLElement>('[data-safe-focus]') || controls()[0])?.focus();
    const handle = (event: KeyboardEvent) => {
      if(over && (event.key === 'Escape' || event.key === 'Tab')) event.stopPropagation();
      if(event.key === 'Escape'){event.preventDefault();close.current();}
      if(event.key === 'Tab'){
        const list=controls(), first=list[0],last=list.at(-1);
        if(!first){event.preventDefault();return;}
        if(event.shiftKey && (document.activeElement===first || !ref.current?.contains(document.activeElement))) {event.preventDefault();last?.focus();}
        else if(!event.shiftKey && (document.activeElement===last || !ref.current?.contains(document.activeElement))) {event.preventDefault();first.focus();}
      }
    };
    document.addEventListener('keydown',handle,over);
    return ()=>{
      document.removeEventListener('keydown',handle,over);
      if (--openTraps === 0) { restorePage(); restorePage = () => { /* nothing is held */ }; }
      if(previous?.isConnected && !previous.closest('[inert]') && previous.getClientRects().length)previous.focus();else if (openTraps === 0) document.querySelector<HTMLElement>('main h1')?.focus();
    };
  },[enabled,ref,backgroundSelector,over]);
}
/** `required`: a question that needs an answer. There is no close button, and neither Escape nor a click outside closes it. */
export function Modal({ title, children, onClose, neutral = false, over = false, required = false }: { title:string; children:ReactNode; onClose:()=>void; neutral?:boolean; over?:boolean; required?:boolean }) {
  const ref=useRef<HTMLDivElement>(null);useFocusTrap(ref,onClose,true,undefined,over);
  const titleId = over ? 'dialog-title-over' : 'dialog-title';
  return <div className={`modal-backdrop${neutral ? ' neutral-scope' : ''}${over ? ' over' : ''}`} onClick={required ? undefined : onClose}><div className="modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={e=>e.stopPropagation()}>{!required && <button className="icon-button modal-close" aria-label="닫기" onClick={onClose}><X size={20}/></button>}<h2 id={titleId}>{title}</h2>{children}</div></div>;
}

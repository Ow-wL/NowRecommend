import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
/** `over`: this dialog may open on top of another one (the health consent over a note being saved). Its keys are then
 * taken before the dialog underneath sees them, so Escape closes one dialog and Tab stays in the one on top. */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, onClose: () => void, enabled = true, backgroundSelector = '.appbar, .main-content, .tabbar, .action-bar, .skip-link', over = false) {
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!enabled) return;
    const previous = document.activeElement as HTMLElement | null;
    const background = Array.from(document.querySelectorAll<HTMLElement>(backgroundSelector));
    const inert = background.map(n=>n.inert);
    background.forEach(n=>n.inert=true);
    const overflow = document.body.style.overflow; document.body.style.overflow='hidden';
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
    return ()=>{background.forEach((n,i)=>n.inert=inert[i]);document.body.style.overflow=overflow;document.removeEventListener('keydown',handle,over);if(previous?.isConnected && !previous.closest('[inert]') && previous.getClientRects().length)previous.focus();else document.querySelector<HTMLElement>('main h1')?.focus();};
  },[enabled,ref,backgroundSelector,over]);
}
export function Modal({ title, children, onClose, neutral = false, over = false }: { title:string; children:ReactNode; onClose:()=>void; neutral?:boolean; over?:boolean }) {
  const ref=useRef<HTMLDivElement>(null);useFocusTrap(ref,onClose,true,undefined,over);
  return <div className={`modal-backdrop${neutral ? ' neutral-scope' : ''}${over ? ' over' : ''}`} onClick={onClose}><div className="modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby={over ? "dialog-title-over" : "dialog-title"} onClick={e=>e.stopPropagation()}><button className="icon-button modal-close" aria-label="닫기" onClick={onClose}><X size={20}/></button><h2 id={over ? "dialog-title-over" : "dialog-title"}>{title}</h2>{children}</div></div>;
}

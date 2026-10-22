import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';

// A dialog over the whole app. Modals stack: only the top one answers Esc. While one is open the
// game's own keyboard shortcuts are held back (keys still work on the dialog's focused buttons),
// except the ones listed in `passKeys`.

const openStack: number[] = [];
let nextId = 1;

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  width?: number;
  passKeys?: string[];
}

export const Modal: React.FC<ModalProps> = ({ open, onClose, title, children, width = 380, passKeys }) => {
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const passRef = React.useRef(passKeys);
  passRef.current = passKeys;

  React.useEffect(() => {
    if (!open) return;
    const id = nextId++;
    openStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (openStack[openStack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        onCloseRef.current();
      } else if (!passRef.current?.includes(e.key.toLowerCase())) {
        e.stopImmediatePropagation();
      }
    };
    // Capture phase on window runs before the game's bubbling shortcut handlers
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      openStack.splice(openStack.indexOf(id), 1);
    };
  }, [open]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[2000] flex items-center justify-center p-6 bg-[#05070b]/70 backdrop-blur-[6px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            className="relative rounded-2xl border border-white/[0.1] bg-[#11151b]/95 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] overflow-hidden"
            style={{ width }}
            initial={{ opacity: 0, scale: 0.94, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 4 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent-cyan/40 to-transparent" />
            {title && (
              <h2 className="px-6 pt-5 font-display font-bold text-[22px] tracking-[0.04em] text-white">{title}</h2>
            )}
            <div className={title ? 'px-6 pb-6 pt-3' : 'p-6'}>{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

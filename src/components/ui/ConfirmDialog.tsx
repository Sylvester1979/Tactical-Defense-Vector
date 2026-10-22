import React from 'react';
import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmDialogProps {
  open: boolean;
  title: React.ReactNode;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// Asks before an action that can't be undone. Cancel has the focus, so Enter is the safe answer.
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open, title, body, confirmLabel, cancelLabel = 'Cancel', danger = false, onConfirm, onCancel,
}) => {
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (open) requestAnimationFrame(() => cancelRef.current?.focus());
  }, [open]);

  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p className="text-[14px] leading-relaxed text-white/70">{body}</p>
      <div className="mt-6 flex justify-end gap-2.5">
        <Button ref={cancelRef} variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  );
};

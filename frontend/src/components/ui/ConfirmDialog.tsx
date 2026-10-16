import type { ReactNode } from 'react';
import { Alert } from './Alert';
import { Button } from './Button';
import { Modal, ModalBody, ModalFooter } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "O'chirish",
  tone = 'danger',
  loading = false,
  error,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} title={title} onClose={onClose} size="sm">
      <ModalBody>
        <div className="text-[13px] text-slate-700">{message}</div>
        {error && (
          <Alert tone="danger" className="mt-3">
            {error}
          </Alert>
        )}
      </ModalBody>
      <ModalFooter>
        <Button onClick={onClose} disabled={loading}>
          Bekor qilish
        </Button>
        <Button variant={tone === 'danger' ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

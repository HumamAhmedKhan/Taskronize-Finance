
import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  isOpen: boolean;
  onClose: () => void;
  onSave?: () => void;
  children: React.ReactNode;
  saveLabel?: string;
  showSaveButton?: boolean;
  maxWidth?: string;
  footerExtra?: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({
  title,
  isOpen,
  onClose,
  onSave,
  children,
  saveLabel = 'Save Changes',
  showSaveButton = true,
  maxWidth = 'max-w-xl',
  footerExtra
}) => {
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className={`relative bg-white rounded-[32px] shadow-2xl ${maxWidth} w-full max-h-[90vh] overflow-hidden flex flex-col border border-gray-100`}>
        <div className="flex items-center justify-between px-8 py-6 border-b border-gray-100">
          <h2 className="text-xl font-extrabold text-gray-900 tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-gray-50 rounded-xl transition-all"
          >
            <X size={22} strokeWidth={2.5} />
          </button>
        </div>

        <div className="overflow-y-auto p-8 flex-1 scrollbar-hide">
          <style>
            {`.scrollbar-hide::-webkit-scrollbar { display: none; }`}
          </style>
          <div className="space-y-6">
            {children}
          </div>
        </div>

        <div className="flex justify-end items-center gap-6 px-8 py-6 bg-gray-50/50 border-t border-gray-100">
          <button
            onClick={onClose}
            className="text-gray-500 font-bold hover:text-gray-900 transition-all text-sm"
          >
            Cancel
          </button>
          {footerExtra}
          {showSaveButton && onSave && (
            <button
              onClick={onSave}
              className="px-8 py-2.5 bg-[#4f46e5] hover:bg-[#4338ca] text-white rounded-xl font-bold transition-all shadow-lg text-sm"
            >
              {saveLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default Modal;

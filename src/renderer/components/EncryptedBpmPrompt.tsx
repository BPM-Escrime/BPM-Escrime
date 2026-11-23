/**
 * BellePoule Modern - Mot de passe d'une archive .bpm chiffrée (RGPD, #1882)
 * Ouverte par l'accueil (« Ouvrir ») ou par Fichier → Ouvrir : le contenu est déjà dans l'écran,
 * l'ouverture passe par le contrat (openCompetitionFile, ADR-0021). Le mot de passe n'est gardé
 * que le temps de la saisie.
 * Licensed under GPL-3.0
 */

import React, { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../shared/api/client';
import { useTranslation } from '../hooks/useTranslation';
import { Button } from './common/Button';

interface EncryptedBpmPromptProps {
  fileName: string;
  /** Ouvre l'archive ; lève ApiError (wrong_password…) si l'ouverture échoue */
  onSubmit: (password: string) => Promise<void>;
  onCancel: () => void;
}

const EncryptedBpmPrompt: React.FC<EncryptedBpmPromptProps> = ({
  fileName,
  onSubmit,
  onCancel,
}) => {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPassword('');
    setError(null);
    inputRef.current?.focus();
  }, [fileName]);

  const open = async () => {
    if (!password || busy) return;
    setBusy(true);
    try {
      await onSubmit(password);
      setPassword('');
    } catch (e) {
      setError(
        t(
          e instanceof ApiError && e.code === 'wrong_password'
            ? 'privacy.bpm_wrong_password'
            : 'privacy.bpm_open_failed'
        )
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-overlay privacy-dialog-overlay"
      onClick={onCancel}
      onKeyDown={e => e.key === 'Escape' && onCancel()}
    >
      <div
        className="modal privacy-dialog"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bpm-password-title"
      >
        <div className="modal-header">
          <h2 className="modal-title" id="bpm-password-title">
            {t('privacy.bpm_open_title')}
          </h2>
        </div>
        <div className="modal-body">
          <p id="bpm-password-message" className="privacy-dialog-message">
            {t('privacy.bpm_open_message', { file: fileName })}
          </p>
          <input
            ref={inputRef}
            type="password"
            className="form-input w-full"
            autoComplete="current-password"
            aria-labelledby="bpm-password-message"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void open();
              }
            }}
          />
          {error && (
            <p role="alert" className="privacy-error">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <Button type="button" onClick={onCancel}>
            {t('actions.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!password || busy}
            onClick={() => void open()}
          >
            {t('privacy.bpm_open')}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default EncryptedBpmPrompt;

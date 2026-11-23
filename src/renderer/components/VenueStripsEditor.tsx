/**
 * BPM - Escrime - Pistes d'une salle : libellé et appareil de piste (#1880, docs/adr/0023)
 * Cyrano (IPv4, port, version) ou OPP2 (identifiant MQTT), mode. Déclaré une fois sur la salle,
 * repris par toutes les épreuves et journées qui s'y tiennent.
 * Licensed under GPL-3.0
 */

import React from 'react';
import { useTranslation } from '../hooks/useTranslation';
import { HINT } from './settingsModal.styles';
import type { VenueStrip } from '../../shared/types/appSettings';
import {
  CYRANO_VERSIONS,
  MAX_OPP2_ID,
  MAX_STRIP_LABEL,
  STRIP_MODES,
  STRIP_PROTOCOLS,
  isIpv4,
  isValidPort,
  stripToEdit,
  type StripEdit,
  type StripMode,
  type StripProtocol,
} from './venueStripsEdit';
import type { CyranoVersion } from '../../shared/types/stripDevice';

interface Props {
  /** Pistes de la salle redimensionnées (numéros 1…n) */
  strips: VenueStrip[];
  edits: Record<number, StripEdit>;
  onChange: (number: number, edit: StripEdit) => void;
}

const VenueStripsEditor: React.FC<Props> = ({ strips, edits, onChange }) => {
  const { t } = useTranslation();
  return (
    <details className="venue-strips-editor">
      <summary>{t('venues.strips_title')}</summary>
      <p style={HINT}>{t('venues.strips_hint')}</p>
      {strips.map(strip => {
        const n = strip.number;
        const edit = edits[n] ?? stripToEdit(strip);
        const ipInvalid = edit.ip.trim() !== '' && !isIpv4(edit.ip);
        const set = (patch: Partial<StripEdit>) => onChange(n, { ...edit, ...patch });
        return (
          <div
            key={n}
            className="venue-strip-row"
            role="group"
            aria-label={t('venues.strip_row', { number: n })}
          >
            <span className="venue-strip-number">{n}</span>
            <input
              type="text"
              className="form-input"
              value={edit.label}
              maxLength={MAX_STRIP_LABEL}
              placeholder={t('venues.strip_label_placeholder', { number: n })}
              aria-label={t('venues.strip_label', { number: n })}
              onChange={e => set({ label: e.target.value })}
            />
            <select
              className="form-select"
              value={edit.protocol}
              aria-label={t('venues.strip_protocol', { number: n })}
              onChange={e => set({ protocol: e.target.value as StripProtocol })}
            >
              {STRIP_PROTOCOLS.map(p => (
                <option key={p} value={p}>
                  {t(`venues.protocol_${p}`)}
                </option>
              ))}
            </select>
            {edit.protocol === 'cyrano' && (
              <>
                <input
                  type="text"
                  inputMode="decimal"
                  className="form-input venue-strip-ip"
                  value={edit.ip}
                  placeholder={t('venues.strip_ip_placeholder')}
                  aria-label={t('venues.strip_ip', { number: n })}
                  aria-invalid={ipInvalid}
                  onChange={e => set({ ip: e.target.value })}
                />
                <input
                  type="text"
                  inputMode="numeric"
                  className="form-input venue-strip-port"
                  value={edit.port}
                  placeholder={t('venues.strip_port_placeholder')}
                  aria-label={t('venues.strip_port', { number: n })}
                  aria-invalid={!isValidPort(edit.port)}
                  onChange={e => set({ port: e.target.value })}
                />
                <select
                  className="form-select"
                  value={edit.version}
                  aria-label={t('venues.strip_version', { number: n })}
                  onChange={e => set({ version: e.target.value as CyranoVersion })}
                >
                  {CYRANO_VERSIONS.map(v => (
                    <option key={v} value={v}>
                      {v === 'auto' ? t('rsm.cyrano_auto') : v}
                    </option>
                  ))}
                </select>
              </>
            )}
            {edit.protocol === 'opp2' && (
              <input
                type="text"
                className="form-input venue-strip-ip"
                value={edit.opp2Id}
                maxLength={MAX_OPP2_ID}
                placeholder={t('venues.strip_opp2_placeholder', { number: n })}
                aria-label={t('venues.strip_opp2_id', { number: n })}
                onChange={e => set({ opp2Id: e.target.value })}
              />
            )}
            {edit.protocol !== 'none' && (
              <select
                className="form-select"
                value={edit.mode}
                aria-label={t('venues.strip_mode', { number: n })}
                onChange={e => set({ mode: e.target.value as StripMode })}
              >
                {STRIP_MODES.map(m => (
                  <option key={m} value={m}>
                    {t(`rsm.cyrano_mode_${m}`)}
                  </option>
                ))}
              </select>
            )}
          </div>
        );
      })}
    </details>
  );
};

export default VenueStripsEditor;

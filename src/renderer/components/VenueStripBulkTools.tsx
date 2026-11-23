/**
 * BellePoule Modern - Déclaration en masse des appareils d'une salle (#2117, docs/adr/0023) :
 * ajout en lot (plage de pistes, IP de départ incrémentée, port, version, profil constructeur),
 * export et import JSON des appareils de la salle. Reprend les outils de l'ancien panneau
 * Cyrano. Le fichier circule par contenu (usePlatform : saveFile / openFile), jamais par chemin.
 * Licensed under GPL-3.0
 */

import React, { useState } from 'react';
import { Download, ListPlus, Upload } from 'lucide-react';
import { useTranslation } from '../hooks/useTranslation';
import { useToast } from './Toast';
import { Button } from './common/Button';
import { Icon } from './common/Icon';
import { useDevicesApi } from '../api/devicesApi';
import { usePlatform } from '../platform/PlatformContext';
import {
  buildStripDeviceBatch,
  STRIP_DEVICE_PROFILES,
  type StripDeviceProfile,
} from '../../shared/domain/stripDevices/stripDevicesFile';
import {
  CYRANO_VERSIONS,
  STRIP_DEVICE_PROTOCOLS,
  type CyranoVersion,
  type StripDeviceProtocol,
} from '../../shared/types/stripDevice';
import { MAX_VENUE_STRIPS } from '../../shared/types/appSettings';

const JSON_FILTER = [{ name: 'JSON', extensions: ['json'] }];

interface Props {
  venueId: string;
  /** Appareils de la salle modifiés : la liste des salles est relue */
  onChanged: () => void;
}

const int = (v: string, min: number, max: number, fallback: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

const VenueStripBulkTools: React.FC<Props> = ({ venueId, onChanged }) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const api = useDevicesApi();
  const platform = usePlatform();
  const [batch, setBatch] = useState({
    from: '1',
    count: '4',
    protocol: 'cyrano' as StripDeviceProtocol,
    profile: '' as StripDeviceProfile['id'] | '',
    startIp: '',
    port: '',
    version: '' as CyranoVersion | '',
  });
  const [importErrors, setImportErrors] = useState<{ line: number; message: string }[]>([]);

  const addBatch = async () => {
    const devices = buildStripDeviceBatch({
      from: int(batch.from, 1, MAX_VENUE_STRIPS, 1),
      count: int(batch.count, 1, MAX_VENUE_STRIPS, 1),
      protocol: batch.protocol,
      ...(batch.startIp.trim() ? { startIp: batch.startIp } : {}),
      ...(batch.port.trim() ? { port: int(batch.port, 1, 65535, 50100) } : {}),
      ...(batch.version ? { version: batch.version } : {}),
      ...(batch.profile ? { profile: batch.profile } : {}),
    });
    if (devices.length === 0) {
      showToast(t('stripControl.bulk_empty'), 'error');
      return;
    }
    try {
      await api.setStripDevices(venueId, devices);
      showToast(t('stripControl.bulk_done', { count: devices.length }), 'success');
      onChanged();
    } catch {
      showToast(t('stripControl.failed'), 'error');
    }
  };

  const exportFile = async () => {
    try {
      const file = await api.getStripDevicesFile(venueId);
      await platform.saveFile({
        suggestedName: file.fileName,
        filters: JSON_FILTER,
        content: file.content,
        mimeType: 'application/json',
        title: t('stripControl.export'),
      });
    } catch {
      showToast(t('stripControl.failed'), 'error');
    }
  };

  const importFile = async () => {
    setImportErrors([]);
    try {
      const opened = await platform.openFile({
        filters: JSON_FILTER,
        title: t('stripControl.import'),
      });
      if (!opened) return;
      // Contrôle d'abord : une seule ligne invalide et rien n'est écrit
      const check = await api.importStripDevices(venueId, opened.content, true);
      if (check.errors.length > 0) {
        setImportErrors(check.errors);
        return;
      }
      const done = await api.importStripDevices(venueId, opened.content);
      showToast(t('stripControl.import_done', { count: done.strips }), 'success');
      onChanged();
    } catch {
      showToast(t('stripControl.import_failed'), 'error');
    }
  };

  return (
    <details className="strip-bulk">
      <summary>{t('stripControl.bulk_title')}</summary>
      <div className="strip-control-form">
        <label className="cyrano-option">
          {t('stripControl.bulk_from')}
          <input
            type="number"
            min={1}
            max={MAX_VENUE_STRIPS}
            className="form-input cyrano-input"
            value={batch.from}
            onChange={e => setBatch({ ...batch, from: e.target.value })}
          />
        </label>
        <label className="cyrano-option">
          {t('stripControl.bulk_count')}
          <input
            type="number"
            min={1}
            max={MAX_VENUE_STRIPS}
            className="form-input cyrano-input"
            value={batch.count}
            onChange={e => setBatch({ ...batch, count: e.target.value })}
          />
        </label>
        <label className="cyrano-option">
          {t('stripControl.bulk_protocol')}
          <select
            className="form-select"
            value={batch.protocol}
            onChange={e => setBatch({ ...batch, protocol: e.target.value as StripDeviceProtocol })}
          >
            {STRIP_DEVICE_PROTOCOLS.map(p => (
              <option key={p} value={p}>
                {t(`venues.protocol_${p}`)}
              </option>
            ))}
          </select>
        </label>
        {batch.protocol === 'cyrano' && (
          <>
            <label className="cyrano-option">
              {t('stripControl.bulk_profile')}
              <select
                className="form-select"
                value={batch.profile}
                onChange={e =>
                  setBatch({ ...batch, profile: e.target.value as StripDeviceProfile['id'] | '' })
                }
              >
                <option value="">{t('stripControl.bulk_profile_none')}</option>
                {STRIP_DEVICE_PROFILES.map(p => (
                  <option key={p.id} value={p.id}>
                    {t(`stripControl.profile_${p.id}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="cyrano-option">
              {t('stripControl.bulk_ip')}
              <input
                type="text"
                inputMode="decimal"
                className="form-input venue-strip-ip"
                value={batch.startIp}
                placeholder="192.168.1.101"
                onChange={e => setBatch({ ...batch, startIp: e.target.value })}
              />
            </label>
            <label className="cyrano-option">
              {t('stripControl.bulk_port')}
              <input
                type="text"
                inputMode="numeric"
                className="form-input venue-strip-port"
                value={batch.port}
                placeholder="50100"
                onChange={e => setBatch({ ...batch, port: e.target.value })}
              />
            </label>
            <label className="cyrano-option">
              {t('stripControl.bulk_version')}
              <select
                className="form-select"
                value={batch.version}
                onChange={e =>
                  setBatch({ ...batch, version: e.target.value as CyranoVersion | '' })
                }
              >
                <option value="">{t('stripControl.bulk_profile_none')}</option>
                {CYRANO_VERSIONS.map(v => (
                  <option key={v} value={v}>
                    {v === 'auto' ? t('rsm.cyrano_auto') : v}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>
      <div className="u-row">
        <Button size="sm" icon={<Icon icon={ListPlus} />} onClick={() => void addBatch()}>
          {t('stripControl.bulk_add')}
        </Button>
        <Button size="sm" icon={<Icon icon={Download} />} onClick={() => void exportFile()}>
          {t('stripControl.export')}
        </Button>
        <Button size="sm" icon={<Icon icon={Upload} />} onClick={() => void importFile()}>
          {t('stripControl.import')}
        </Button>
      </div>
      {importErrors.length > 0 && (
        <div className="form-error" role="alert">
          <p>{t('stripControl.import_errors')}</p>
          <ul>
            {importErrors.map(e => (
              <li key={`${e.line}-${e.message}`}>
                {t('stripControl.import_line', { line: e.line, message: e.message })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
};

export default VenueStripBulkTools;

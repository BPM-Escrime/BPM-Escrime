// @vitest-environment jsdom
/**
 * Paramètres → Confidentialité (RGPD, #1882) : recherche d'une personne, anonymisation
 * confirmée, archive chiffrée (mots de passe vérifiés avant l'appel au main).
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../hooks/useTranslation', () => import('../testUtils/i18nMock'));
import PrivacySettingsSection from './PrivacySettingsSection';
import { ConfirmProvider } from './ConfirmDialog';
import { ToastProvider } from './Toast';
import { stationElectron } from '../testUtils/stationBridge';

const person = {
  key: 'lic:777',
  lastName: 'LEFEVRE',
  firstName: 'Zoé',
  birthDate: null,
  license: '777',
  club: 'CE',
  fencers: [
    { fencerId: 'f1', competitionId: 'c1', competitionTitle: 'Open', competitionDate: null },
  ],
  members: [{ memberId: 'm1', clubId: 'k', clubName: 'CE' }],
};

let privacy: Record<string, ReturnType<typeof vi.fn>>;
let encrypted: ReturnType<typeof vi.fn<(input: Record<string, unknown>) => unknown>>;
let saveFile: ReturnType<typeof vi.fn>;
let writeContent: ReturnType<typeof vi.fn>;

beforeEach(() => {
  privacy = {
    getSettings: vi.fn(async () => ({
      nameMasking: 'full',
      competitionRetentionMonths: 0,
      memberRetentionMonths: 0,
      retentionAction: 'anonymize',
      autoPurge: false,
    })),
    findPersons: vi.fn(async () => [person]),
    anonymizePerson: vi.fn(async () => ({ fencers: 1, members: 1, pseudonym: 'Anonyme X' })),
  };
  // Archive chiffrée par le contrat (contenu base64), enregistrée par la plateforme (ADR-0021)
  encrypted = vi.fn((_input: Record<string, unknown>): unknown => ({
    fileName: 'competition.bpm',
    content: 'QlBN',
  }));
  saveFile = vi.fn(async () => ({ filePath: '/tmp/competition.bpm', success: true }));
  writeContent = vi.fn(async () => undefined);
  (window as unknown as { electronAPI: unknown }).electronAPI = stationElectron(
    { privacy },
    {
      api: { getEncryptedCompetitionFile: encrypted, listCompetitions: () => [] },
      dialog: { saveFile },
      file: { writeContent },
    }
  );
});

const wrap = (item: React.ComponentProps<typeof PrivacySettingsSection>['item']) =>
  render(
    <ToastProvider>
      <ConfirmProvider>
        <PrivacySettingsSection item={item} />
      </ConfirmProvider>
    </ToastProvider>
  );

describe('PrivacySettingsSection', () => {
  it('trouve une personne et l’anonymise après confirmation', async () => {
    wrap('privacy_person');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lef' } });
    await screen.findByText(/LEFEVRE Zoé/);
    fireEvent.click(screen.getByRole('button', { name: 'Anonymiser' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(b => b.textContent === 'Anonymiser')!
    );
    await waitFor(() =>
      expect(privacy.anonymizePerson).toHaveBeenCalledWith({ fencerIds: ['f1'], memberIds: ['m1'] })
    );
  });

  it('archive chiffrée : refuse des mots de passe différents', async () => {
    wrap('privacy_bpm');
    const [p1, p2] = screen.getAllByLabelText(/Mot de passe|Confirmation/);
    fireEvent.change(p1, { target: { value: 'motdepasse1' } });
    fireEvent.change(p2, { target: { value: 'motdepasse2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Exporter chiffré' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Les mots de passe diffèrent.');
    expect(encrypted).not.toHaveBeenCalled();
    fireEvent.change(p2, { target: { value: 'motdepasse1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Exporter chiffré' }));
    await waitFor(() =>
      expect(encrypted).toHaveBeenCalledWith({ competitionId: null, password: 'motdepasse1' })
    );
    await waitFor(() =>
      expect(writeContent).toHaveBeenCalledWith(
        '/tmp/competition.bpm',
        new Uint8Array([66, 80, 77])
      )
    );
  });

  it('export JSON d’une personne : getPersonData puis « Enregistrer sous »', async () => {
    privacy.getPersonData = vi.fn(async () => ({ competitions: [{ id: 'c1' }], club: [] }));
    wrap('privacy_person');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'lef' } });
    await screen.findByText(/LEFEVRE Zoé/);
    fireEvent.click(screen.getByRole('button', { name: 'Exporter (JSON)' }));
    await waitFor(() => expect(writeContent).toHaveBeenCalled());
    expect(privacy.getPersonData).toHaveBeenCalledWith({ fencerIds: ['f1'], memberIds: ['m1'] });
    expect(saveFile.mock.calls[0][0]).toMatchObject({ defaultPath: 'LEFEVRE_Zoé.json' });
    expect(JSON.parse(writeContent.mock.calls[0][1])).toEqual({
      competitions: [{ id: 'c1' }],
      club: [],
    });
  });
});

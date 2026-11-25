/**
 * BPM - Escrime - Modèles de formule pour l'écran (#2013 étape B2, docs/adr/0033)
 * Liste par le contrat (listFormulaTemplates) ; hors poste (navigateur, tests sans pont) :
 * catalogue fourni du domaine seulement. Reprise unique des modèles du stockage local
 * (ancienne bibliothèque « À la carte ») vers le poste, puis effacement de la clé locale.
 * Licensed under GPL-3.0
 */

import { useCallback, useEffect, useState } from 'react';
import { Category, Weapon } from '../../shared/types';
import {
  filterTemplates,
  standardTemplate,
  type FormulaTemplate,
  type FormulaTemplateBody,
} from '../../shared/domain/formula/formulaTemplate';
import { providedTemplates } from '../../shared/domain/formula/presets/bpmTemplates';
import {
  deleteCustomFormulaTemplate,
  getCustomFormulaTemplates,
} from '../../shared/utils/tournamentTemplates';
import { logger, LogCategory, toError } from '../../shared/services/logger';
import { stationAvailable, useStationApi } from '../api/stationApi';

export interface FormulaTemplatesContext {
  weapon: Weapon;
  category: Category;
  isTeamEvent: boolean;
}

let localImportDone = false;

/** Modèles de l'ancienne bibliothèque locale enregistrés sur le poste, une seule fois */
async function importLocalTemplates(
  save: (input: { name: string; body: FormulaTemplateBody }) => Promise<unknown>
): Promise<void> {
  if (localImportDone) return;
  localImportDone = true;
  for (const entry of getCustomFormulaTemplates()) {
    try {
      await save({
        name: entry.name.slice(0, 80),
        body: { kind: 'custom', formula: entry.formula },
      });
      deleteCustomFormulaTemplate(entry.name);
    } catch (e) {
      // Modèle refusé (formule hors bornes) : il reste dans le stockage local, rien n'est perdu
      logger.warn(LogCategory.SYSTEM, `Modèle local « ${entry.name} » non repris`, toError(e));
    }
  }
}

export function useFormulaTemplates(ctx: FormulaTemplatesContext) {
  const api = useStationApi().formulaTemplates;
  const [all, setAll] = useState<FormulaTemplate[]>(() => [...providedTemplates()]);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!stationAvailable()) return;
    let alive = true;
    void (async () => {
      try {
        await importLocalTemplates(api.save);
        const r = await api.list({});
        if (alive) setAll(r.templates);
      } catch (e) {
        logger.warn(LogCategory.SYSTEM, 'Modèles de formule indisponibles', toError(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [api, version]);

  const reload = useCallback(() => setVersion(v => v + 1), []);
  const templates = filterTemplates(all, ctx);
  const standard = standardTemplate(all, ctx);
  return { all, templates, standard, reload, save: api.save, available: stationAvailable() };
}

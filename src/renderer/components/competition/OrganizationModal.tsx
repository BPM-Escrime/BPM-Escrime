/**
 * BPM - Escrime - Organisation de l'épreuve : raccourcis vers le plan de salle (arènes)
 * et la feuille de route, ouverts par l'engrenage placé avant l'appel.
 * Licensed under GPL-3.0
 */

import React from 'react';
import { FileText, LayoutGrid } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Modal from '../common/Modal';

interface OrganizationModalProps {
  t: (key: string, params?: { [key: string]: string | number }) => string;
  onClose: () => void;
  onOpenArenaPlanner?: () => void;
  onOpenRoadmap?: () => void;
}

interface Shortcut {
  id: string;
  icon: LucideIcon;
  label: string;
  desc: string;
  action: () => void;
}

export const OrganizationModal: React.FC<OrganizationModalProps> = ({
  t,
  onClose,
  onOpenArenaPlanner,
  onOpenRoadmap,
}) => {
  const shortcuts: Shortcut[] = [];
  if (onOpenArenaPlanner)
    shortcuts.push({
      id: 'arena-planner',
      icon: LayoutGrid,
      label: t('app.arena_planner'),
      desc: t('competitionNav.organization_arena_desc'),
      action: onOpenArenaPlanner,
    });
  if (onOpenRoadmap)
    shortcuts.push({
      id: 'roadmap',
      icon: FileText,
      label: t('app.roadmap'),
      desc: t('competitionNav.organization_roadmap_desc'),
      action: onOpenRoadmap,
    });

  return (
    <Modal title={t('competitionNav.organization')} onClose={onClose} size="sm">
      <p className="organization-intro">{t('competitionNav.organization_intro')}</p>
      <div className="organization-shortcuts">
        {shortcuts.map(s => (
          <button
            key={s.id}
            type="button"
            className="organization-shortcut"
            data-testid={`organization-${s.id}`}
            onClick={() => {
              onClose();
              s.action();
            }}
          >
            <s.icon size={22} aria-hidden="true" />
            <span className="organization-shortcut-text">
              <strong>{s.label}</strong>
              <span>{s.desc}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
};

export default OrganizationModal;

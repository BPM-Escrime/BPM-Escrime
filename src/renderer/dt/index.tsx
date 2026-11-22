/**
 * BellePoule Modern - Vue DT dans un navigateur (#1981 lot 3, docs/adr/0020)
 * Entrée Webpack `dt` (cible web), servie par le serveur distant sous /dt/. Lecture seule :
 * le contrat passe par WsClient (Socket.IO /api), jamais par window.electronAPI.
 * Licensed under GPL-3.0
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { TranslationProvider } from '../contexts/TranslationContext';
import { DtApp } from './DtApp';
import { browserLanguage } from './dtFormat';
import './dt.css';

// Langue du navigateur au premier passage (l'écran Electron reçoit la sienne du préload)
try {
  if (!localStorage.getItem('bellepoule-language')) {
    localStorage.setItem('bellepoule-language', browserLanguage(navigator.languages));
  }
} catch {
  // Stockage indisponible (navigation privée) : français par défaut
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <TranslationProvider>
      <DtApp />
    </TranslationProvider>
  );
}

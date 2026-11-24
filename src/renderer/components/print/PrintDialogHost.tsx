/**
 * BPM - Escrime - Hôte de la boîte d'impression intégrée (#1214)
 * Enregistre auprès du preload le gestionnaire des demandes `file.printHtml` : chaque bouton
 * « Imprimer » ouvre la boîte (chargée à la demande) et reçoit son résultat.
 * Bureau seulement (`usePlatform().desktop`, ADR-0030) : ailleurs, rien n'est rendu et
 * « Imprimer » passe par PlatformServices.print.
 * Licensed under GPL-3.0
 */

import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { PrintDialogResult } from './PrintDialog';
import { usePlatform } from '../../platform/PlatformContext';

const PrintDialog = React.lazy(() => import('./PrintDialog'));

interface PrintRequest {
  html: string;
  resolve: (result: PrintDialogResult) => void;
}

const PrintDialogHost: React.FC = () => {
  const [request, setRequest] = useState<PrintRequest | null>(null);
  const current = useRef<PrintRequest | null>(null);
  const printDialog = usePlatform().desktop?.printDialog;

  const open = useCallback(
    (html: string) =>
      new Promise<PrintDialogResult>(resolve => {
        // Une seule boîte à la fois : la précédente est annulée
        current.current?.resolve({ success: true, canceled: true });
        const next = { html, resolve };
        current.current = next;
        setRequest(next);
      }),
    []
  );

  useEffect(() => {
    printDialog?.setHandler(open);
    return () => printDialog?.setHandler(null);
  }, [printDialog, open]);

  if (!request || !printDialog) return null;
  return (
    <Suspense fallback={null}>
      <PrintDialog
        key={request.html.length + ':' + request.html.slice(0, 64)}
        html={request.html}
        printDialog={printDialog}
        onDone={result => {
          request.resolve(result);
          if (current.current === request) current.current = null;
          setRequest(null);
        }}
      />
    </Suspense>
  );
};

export default PrintDialogHost;

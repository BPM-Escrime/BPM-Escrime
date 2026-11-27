/**
 * Wiki intégré : article « Formules : les briques » (#2013 F5). Résumé de docs/FORMULES.md, une
 * section par brique de l'éditeur de formule ; chaque titre porte l'ancre du lien « ? » de la carte
 * de la phase (`formulaHelp.ts`). Même structure dans les 7 langues : les blocs sont construits
 * depuis une seule forme (`Copy`), jamais écrits à la main langue par langue.
 * Séparé de wikiData.ts pour rester sous le plafond de taille des fichiers (#1155).
 */
import type { WikiArticle, WikiLang, WikiSection } from './wiki.types';
import { ADVANCED_ARTICLES } from './wikiAdvancedArticles';
import { FORMULA_HELP_TOPICS, type FormulaHelpTopic } from '../formula/formulaHelp';

interface Copy {
  title: string;
  intro: string;
  /** Titre de chaque section */
  headings: Record<FormulaHelpTopic, string>;
  /** Paragraphe de chaque section, sauf la qualification (liste) */
  bodies: Record<Exclude<FormulaHelpTopic, 'qualification'>, string>;
  /** Qualification : modes, têtes de poule, ex aequo à la barre */
  qualification: [string, string, string];
  tip: string;
}

const COPY: Record<WikiLang, Copy> = {
  fr: {
    title: 'Formules : les briques',
    intro:
      "La formule décrit le déroulé de l'épreuve : une suite de phases entre l'Appel et le Classement final. Elle se règle à la création et dans Organisation ▸ Formule. Chaque brique a un lien « ? » dans l'éditeur.",
    headings: {
      pools: 'Tour de poules',
      qualification: 'Qualification entre phases',
      quest: 'Tour Quest',
      tableau: 'Tableau',
      'stopped-tableau': 'Tableau arrêté à N',
      split: 'Scission en compétitions filles',
      waves: 'Tour en vagues',
      'team-entry': 'Entrée en équipes (binômes)',
      'ranking-filters': 'Classements filtrés',
      expert: 'Mode expert',
      checks: 'Contrôles de structure',
    },
    bodies: {
      pools:
        "Jusqu'à 5 tours enchaînés, chacun avec ses touches, sa durée et sa taille de poule. Zéro tour est permis : le tableau est alors placé au classement d'entrée.",
      quest:
        "Sabre Laser seulement (mode expert). Placé après l'Appel ou après un seul tour de poules. Incompatible avec un tableau arrêté et une scission.",
      tableau:
        "Il va jusqu'à la finale : touches, durée, match pour la 3e place, tous les classements. Rien ne peut le suivre.",
      'stopped-tableau':
        "Mode expert. Le tableau s'arrête quand il reste N tireurs, qui passent à un tour de poules ou à une scission. Le bandeau « Passer à la phase suivante » clôt l'étape.",
      split:
        "Mode expert, toujours en dernière phase. Répartition par sexe, catégorie, rang ou à la main. Chaque branche devient une compétition fille classée à part. En scission par sexe, « Rester dans l'épreuve » joue les deux tableaux dans la même épreuve (compétition couplée).",
      waves:
        'Mode expert (ordre des matchs). Les matchs se jouent par vagues et les tablettes suivent la vague en cours. Poules de 2 à 10 tireurs, de 2 à 15 en vagues classiques.',
      'team-entry':
        "Mode expert. Le binôme s'inscrit sous un nom d'équipe avec ses deux membres et un niveau. La catégorie de l'équipe est la moyenne des années de naissance. Répartition par niveau possible dans les poules.",
      'ranking-filters':
        "Mode expert. Catégorie, sexe, niveau, HANDI : l'écran, le PDF et le CSV proposent un classement filtré, renuméroté depuis 1. C'est un affichage : le classement publié reste complet.",
      expert:
        "Préférence du poste, éteinte par défaut. Elle ajoute : scission, Tour Quest, tableau arrêté, têtes de poule, ex aequo à la barre, réglages avancés des poules, entrée en équipes et filtres. Une formule qui en contient rallume le mode pour l'édition.",
      checks:
        "L'éditeur signale en direct les erreurs bloquantes (S1 à S6) sur la carte de la phase : au moins une phase de combat, tableau arrêté suivi d'une phase, effectif suffisant, branches classées, phase commencée protégée. Enregistrer reste grisé tant qu'une erreur demeure.",
    },
    qualification: [
      'Tous avancent, Top %, Nombre fixe, Tableau suivant, Vainqueur de poule.',
      "Têtes de poule (expert) : les premiers de chaque poule, puis les deuxièmes, jusqu'au nombre demandé.",
      "Ex aequo à la barre (expert) : tous qualifiés, départagés au classement d'entrée, ou tirage au sort (FIE o.73.2.f). Le barrage est reporté.",
    ],
    tip: "Guide complet de l'organisateur : docs/FORMULES.md (exemples A à G, Tournoi des rapières).",
  },
  en: {
    title: 'Formulas: the building blocks',
    intro:
      'The formula describes how the event runs: a sequence of phases between Check-in and the Final ranking. Set it when creating the event and in Organisation ▸ Formula. Each block has a "?" link in the editor.',
    headings: {
      pools: 'Pool round',
      qualification: 'Qualification between phases',
      quest: 'Quest round',
      tableau: 'Bracket',
      'stopped-tableau': 'Bracket stopped at N',
      split: 'Split into child competitions',
      waves: 'Waves round',
      'team-entry': 'Team entry (pairs)',
      'ranking-filters': 'Filtered rankings',
      expert: 'Expert mode',
      checks: 'Structure checks',
    },
    bodies: {
      pools:
        'Up to 5 rounds in a row, each with its own touches, duration and pool size. Zero rounds is allowed: the bracket is then seeded from the entry ranking.',
      quest:
        'Laser Sabre only (expert mode). Placed after Check-in or after a single pool round. Not compatible with a stopped bracket or a split.',
      tableau:
        'It runs to the final: touches, duration, 3rd place match, all places. Nothing can follow it.',
      'stopped-tableau':
        'Expert mode. The bracket stops when N fencers remain; they move on to a pool round or a split. The "Move to next phase" banner closes the stage.',
      split:
        'Expert mode, always the last phase. Split by gender, category, rank or by hand. Each branch becomes a child competition ranked separately. With a gender split, "Stay in the event" plays both brackets in the same event (coupled competition).',
      waves:
        'Expert mode (bout order). Bouts are played in waves and the tablets follow the current wave. Pools of 2 to 10 fencers, 2 to 15 with classic waves.',
      'team-entry':
        'Expert mode. A pair enters under a team name with its two members and a level. The team category is the average of the birth years. Pools can be distributed by level.',
      'ranking-filters':
        'Expert mode. Category, gender, level, HANDI: the screen, PDF and CSV offer a filtered ranking, renumbered from 1. It is a display only: the published ranking stays complete.',
      expert:
        'A per-computer preference, off by default. It adds: split, Quest round, stopped bracket, pool heads, ties at the cut, advanced pool settings, team entry and filters. A formula that contains some turns the mode back on for the edit.',
      checks:
        'The editor flags blocking errors (S1 to S6) live on the phase card: at least one fight phase, a stopped bracket followed by a phase, enough fencers, ranked branches, started phase protected. Save stays disabled while an error remains.',
    },
    qualification: [
      'All advance, Top %, Fixed number, Next bracket, Pool winner.',
      'Pool heads (expert): the first of each pool, then the second, up to the requested number.',
      'Ties at the cut (expert): all qualify, split by entry ranking, or draw (FIE o.73.2.f). The barrage is postponed.',
    ],
    tip: "Full organiser's guide: docs/FORMULES.md (examples A to G, Rapier tournament).",
  },
  de: {
    title: 'Formeln: die Bausteine',
    intro:
      'Die Formel beschreibt den Ablauf des Wettkampfs: eine Folge von Phasen zwischen Anmeldung und Endrangliste. Sie wird bei der Erstellung und unter Organisation ▸ Formel eingestellt. Jeder Baustein hat im Editor einen „?“-Link.',
    headings: {
      pools: 'Pool-Runde',
      qualification: 'Qualifikation zwischen Phasen',
      quest: 'Quest-Runde',
      tableau: 'Tableau',
      'stopped-tableau': 'Bei N angehaltenes Tableau',
      split: 'Aufteilung in Tochter-Wettkämpfe',
      waves: 'Wellen-Runde',
      'team-entry': 'Teameintrag (Paare)',
      'ranking-filters': 'Gefilterte Ranglisten',
      expert: 'Expertenmodus',
      checks: 'Strukturprüfungen',
    },
    bodies: {
      pools:
        'Bis zu 5 aufeinanderfolgende Runden, jede mit eigenen Treffern, Dauer und Poolgröße. Null Runden sind erlaubt: Das Tableau wird dann nach der Eingangsrangliste gesetzt.',
      quest:
        'Nur Laser-Säbel (Expertenmodus). Nach der Anmeldung oder nach einer einzigen Pool-Runde. Nicht mit einem angehaltenen Tableau oder einer Aufteilung kombinierbar.',
      tableau:
        'Es läuft bis zum Finale: Treffer, Dauer, Gefecht um Platz 3, alle Plätze. Danach kann nichts folgen.',
      'stopped-tableau':
        'Expertenmodus. Das Tableau hält an, wenn N Fechter übrig sind; sie gehen in eine Pool-Runde oder eine Aufteilung. Das Banner „Zur nächsten Phase“ schließt die Etappe.',
      split:
        'Expertenmodus, immer die letzte Phase. Aufteilung nach Geschlecht, Kategorie, Rang oder von Hand. Jeder Zweig wird ein eigener Tochter-Wettkampf mit eigener Rangliste. Bei der Aufteilung nach Geschlecht spielt „Im Wettkampf bleiben“ beide Tableaus im selben Wettkampf (gekoppelter Wettkampf).',
      waves:
        'Expertenmodus (Gefechtsreihenfolge). Die Gefechte werden in Wellen gespielt, die Tablets folgen der laufenden Welle. Pools von 2 bis 10 Fechtern, bis 15 bei klassischen Wellen.',
      'team-entry':
        'Expertenmodus. Das Paar meldet sich unter einem Teamnamen mit seinen zwei Mitgliedern und einem Niveau. Die Teamkategorie ist der Durchschnitt der Geburtsjahre. Verteilung der Pools nach Niveau möglich.',
      'ranking-filters':
        'Expertenmodus. Kategorie, Geschlecht, Niveau, HANDI: Bildschirm, PDF und CSV bieten eine gefilterte Rangliste, ab 1 neu nummeriert. Es ist nur eine Anzeige: Die veröffentlichte Rangliste bleibt vollständig.',
      expert:
        'Einstellung dieses Rechners, standardmäßig aus. Sie ergänzt: Aufteilung, Quest-Runde, angehaltenes Tableau, Pool-Spitzen, Gleichstand an der Grenze, erweiterte Pool-Einstellungen, Teameintrag und Filter. Eine Formel, die davon enthält, schaltet den Modus für die Bearbeitung wieder ein.',
      checks:
        'Der Editor zeigt blockierende Fehler (S1 bis S6) direkt auf der Phasenkarte: mindestens eine Kampfphase, auf ein angehaltenes Tableau folgt eine Phase, genug Fechter, eingestufte Zweige, begonnene Phase geschützt. „Speichern“ bleibt gesperrt, solange ein Fehler besteht.',
    },
    qualification: [
      'Alle kommen weiter, Top %, Feste Anzahl, Nächstes Tableau, Pool-Sieger.',
      'Pool-Spitzen (Experte): die Ersten jedes Pools, dann die Zweiten, bis zur gewünschten Anzahl.',
      'Gleichstand an der Grenze (Experte): alle qualifiziert, nach Eingangsrangliste getrennt oder Los (FIE o.73.2.f). Das Stichkampf-Verfahren ist verschoben.',
    ],
    tip: 'Vollständiger Leitfaden für Organisatoren: docs/FORMULES.md (Beispiele A bis G, Rapier-Turnier).',
  },
  es: {
    title: 'Fórmulas: los bloques',
    intro:
      'La fórmula describe el desarrollo de la prueba: una secuencia de fases entre el Pase de lista y la Clasificación final. Se ajusta al crear la prueba y en Organización ▸ Fórmula. Cada bloque tiene un enlace «?» en el editor.',
    headings: {
      pools: 'Ronda de poules',
      qualification: 'Clasificación entre fases',
      quest: 'Ronda Quest',
      tableau: 'Cuadro',
      'stopped-tableau': 'Cuadro detenido en N',
      split: 'División en competiciones hijas',
      waves: 'Ronda por oleadas',
      'team-entry': 'Inscripción por equipos (parejas)',
      'ranking-filters': 'Clasificaciones filtradas',
      expert: 'Modo experto',
      checks: 'Controles de estructura',
    },
    bodies: {
      pools:
        'Hasta 5 rondas seguidas, cada una con sus tocados, su duración y su tamaño de poule. Se permiten cero rondas: el cuadro se coloca entonces según la clasificación de entrada.',
      quest:
        'Solo Sable Láser (modo experto). Se coloca tras el Pase de lista o tras una sola ronda de poules. Incompatible con un cuadro detenido y con una división.',
      tableau:
        'Llega hasta la final: tocados, duración, combate por el 3.er puesto, todos los puestos. Nada puede seguirle.',
      'stopped-tableau':
        'Modo experto. El cuadro se detiene cuando quedan N tiradores, que pasan a una ronda de poules o a una división. El aviso «Pasar a la fase siguiente» cierra la etapa.',
      split:
        'Modo experto, siempre la última fase. Reparto por sexo, categoría, puesto o a mano. Cada rama se convierte en una competición hija clasificada aparte. En la división por sexo, «Permanecer en la prueba» juega los dos cuadros en la misma prueba (competición acoplada).',
      waves:
        'Modo experto (orden de los combates). Los combates se juegan por oleadas y las tabletas siguen la oleada en curso. Poules de 2 a 10 tiradores, de 2 a 15 en oleadas clásicas.',
      'team-entry':
        'Modo experto. La pareja se inscribe con un nombre de equipo, sus dos miembros y un nivel. La categoría del equipo es la media de los años de nacimiento. Reparto por nivel posible en las poules.',
      'ranking-filters':
        'Modo experto. Categoría, sexo, nivel, HANDI: la pantalla, el PDF y el CSV ofrecen una clasificación filtrada, renumerada desde 1. Es solo una vista: la clasificación publicada sigue completa.',
      expert:
        'Preferencia de este equipo, desactivada por defecto. Añade: división, ronda Quest, cuadro detenido, cabezas de poule, empates en el corte, ajustes avanzados de las poules, inscripción por equipos y filtros. Una fórmula que los contenga reactiva el modo durante la edición.',
      checks:
        'El editor señala en directo los errores bloqueantes (S1 a S6) en la tarjeta de la fase: al menos una fase de combate, cuadro detenido seguido de una fase, suficientes tiradores, ramas clasificadas, fase iniciada protegida. «Guardar» permanece desactivado mientras haya un error.',
    },
    qualification: [
      'Todos avanzan, Top %, Número fijo, Cuadro siguiente, Ganador de poule.',
      'Cabezas de poule (experto): los primeros de cada poule, luego los segundos, hasta el número pedido.',
      'Empates en el corte (experto): todos clasificados, desempate por la clasificación de entrada o sorteo (FIE o.73.2.f). El desempate por combate queda aplazado.',
    ],
    tip: 'Guía completa del organizador: docs/FORMULES.md (ejemplos A a G, Torneo de rapieras).',
  },
  'zh-HK': {
    title: '賽制：基本組件',
    intro:
      '賽制描述賽事的進行方式：在點名與最終排名之間的一連串階段。可在建立賽事時及「組織 ▸ 賽制」中設定。編輯器內每個組件都有「?」連結。',
    headings: {
      pools: '分組循環賽',
      qualification: '階段之間的晉級',
      quest: 'Quest 回合',
      tableau: '淘汰賽表',
      'stopped-tableau': '在 N 人時停止的淘汰賽表',
      split: '分拆為子賽事',
      waves: '分批回合',
      'team-entry': '組隊報名（雙人）',
      'ranking-filters': '篩選排名',
      expert: '專家模式',
      checks: '結構檢查',
    },
    bodies: {
      pools:
        '最多連續 5 個回合，每個回合有各自的得分、時間及小組人數。可以沒有回合：此時淘汰賽表按入場排名編排。',
      quest:
        '只適用於激光佩劍（專家模式）。放在點名之後，或僅一個分組回合之後。不能與停止的淘汰賽表或分拆並用。',
      tableau: '一直打到決賽：得分、時間、季軍賽、所有名次。其後不能再接任何階段。',
      'stopped-tableau':
        '專家模式。淘汰賽表在剩下 N 名劍手時停止，他們進入分組回合或分拆。按「進入下一階段」橫幅結束此階段。',
      split:
        '專家模式，必定是最後一個階段。可按性別、組別、名次或手動分配。每個分支成為獨立排名的子賽事。按性別分拆時，「留在本賽事」會在同一賽事內進行兩個淘汰賽表（合併賽事）。',
      waves:
        '專家模式（比賽次序）。比賽分批進行，平板電腦跟隨目前批次。每組 2 至 10 人，經典分批最多 15 人。',
      'team-entry':
        '專家模式。雙人組合以隊名報名，附兩名成員及級別。隊伍組別為成員出生年份的平均值。可按級別分配小組。',
      'ranking-filters':
        '專家模式。組別、性別、級別、HANDI：畫面、PDF 及 CSV 提供篩選後的排名，由 1 重新編號。這只是顯示方式：公布的排名仍然完整。',
      expert:
        '此電腦的偏好設定，預設關閉。會額外顯示：分拆、Quest 回合、停止的淘汰賽表、小組頭名、臨界同分處理、進階小組設定、組隊報名及篩選。若賽制已包含這些項目，編輯期間會重新開啟專家模式。',
      checks:
        '編輯器會在階段卡片上即時標示阻擋性錯誤（S1 至 S6）：至少一個比賽階段、停止的淘汰賽表之後須有階段、人數足夠、各分支有排名、已開始的階段受保護。有錯誤時「儲存」保持停用。',
    },
    qualification: [
      '全部晉級、前 %、固定人數、下一個淘汰賽表、小組勝者。',
      '小組頭名（專家）：每組第一名，然後第二名，直至所需人數。',
      '臨界同分（專家）：全部晉級、按入場排名分出高下，或抽籤（FIE o.73.2.f）。加賽延後處理。',
    ],
    tip: '完整的主辦者指南：docs/FORMULES.md（示例 A 至 G、細劍錦標賽）。',
  },
  br: {
    title: 'Formulennoù : ar brikennoù',
    intro:
      "Ar formulenn a zeskriv penn-kentañ an abadenn : ur renkad fazennoù etre ar Galv hag ar Renkadur dibenn. Reizhañ a c'haller pa grouer an abadenn ha en Aozadur ▸ Formulenn. Pep brikenn he deus ur c'her-ere « ? » en embanner.",
    headings: {
      pools: 'Tro poulloù',
      qualification: 'Kalafikadur etre fazennoù',
      quest: 'Tro Quest',
      tableau: 'Taolenn',
      'stopped-tableau': 'Taolenn paouezet e N',
      split: 'Rannadur e kenstrivadegoù merc’h',
      waves: 'Tro gant tonnoù',
      'team-entry': 'Enskrivadur dre skipailhoù (daou-ha-daou)',
      'ranking-filters': 'Renkadurioù sil',
      expert: 'Mod arbennigour',
      checks: 'Gwiriadennoù ar framm',
    },
    bodies: {
      pools:
        "Betek 5 tro dalc'hmat, pep hini gant e daolioù, e padelezh hag e vent poull. Aotreet eo mont hep tro ebet : lakaet e vez an daolenn diouzh ar renkadur kregiñ neuze.",
      quest:
        'Sabr Laser hepken (mod arbennigour). Lakaet goude ar Galv pe goude un tro poulloù hepken. Ne ya ket asambles gant un daolenn paouezet nag ur rannadur.',
      tableau:
        "Mont a ra betek ar fin : taolioù, padelezh, emgann evit an 3vet plas, an holl renkoù. Netra ne c'hall mont war e lerc'h.",
      'stopped-tableau':
        "Mod arbennigour. Paouez a ra an daolenn pa chom N tenner : mont a reont d'un tro poulloù pe d'ur rannadur. Serriñ a ra ar bannell « Tremen d'ar fazenn war-lerc'h » ar c'hammed.",
      split:
        "Mod arbennigour, atav ar fazenn ziwezhañ. Rannet diouzh ar reizh, ar rummad, ar renk pe gant an dorn. Pep skourr a zeu da vezañ ur genstrivadeg verc'h renket hec'h-unan. Gant ur rannadur dre reizh e c'hoari « Chom er genstrivadeg » an daou daolenn er memes kenstrivadeg.",
      waves:
        "Mod arbennigour (urzh an emgannoù). C'hoariet e vez an emgannoù dre donnoù hag ar bladennoù a heuilh an donn red. Poulloù eus 2 da 10 tenner, eus 2 da 15 gant tonnoù klasel.",
      'team-entry':
        'Mod arbennigour. An daou-ha-daou a enskriv dindan un anv skipailh gant e zaou ezel hag ul live. Rummad ar skipailh eo keidenn bloavezhioù ganedigezh an izili. Posubl eo bevaat ar poulloù dre live.',
      'ranking-filters':
        'Mod arbennigour. Rummad, reizh, live, HANDI : an skramm, ar PDF hag ar CSV a ginnig ur renkadur sil, niverennet adalek 1. Diskwel hepken eo : ar renkadur embannet a chom klok.',
      expert:
        "Dibaboù ar poste-mañ, lazhet dre ziouer. Ouzhpennañ a ra : rannadur, tro Quest, taolenn paouezet, pennoù poull, par d'ar bevenn, arventennoù araokaet ar poulloù, enskrivadur dre skipailhoù ha siloù. Ur formulenn o c'hrafe a adlugerniñ ar mod evit an embann.",
      checks:
        "An embanner a ziskouez war ar mare fazioù stankus (S1 da S6) war kartenn ar fazenn : ur fazenn emgann da nebeutañ, ur fazenn war-lerc'h un daolenn paouezet, tud a-walc'h, skourroù renket, fazenn krog gwarezet. Chom a ra « Enrollañ » lazhet keit ha ma chom ur fazi.",
    },
    qualification: [
      "An holl a ya war-raok, Top %, Niver stag, Taolenn war-lerc'h, Gounezer poull.",
      'Pennoù poull (arbennigour) : an dud kentañ eus pep poull, da c’hortoz an eil, betek an niver goulennet.',
      "Par d'ar bevenn (arbennigour) : an holl kalifiet, dispartiet dre ar renkadur kregiñ, pe dre denn-dre-zoare (FIE o.73.2.f). Dale eo ar barrage.",
    ],
    tip: 'Hent klok an aozer : docs/FORMULES.md (skouerioù A da G, Kevezadeg ar rapierennoù).',
  },
  ca: {
    title: 'Fórmules: els blocs',
    intro:
      'La fórmula descriu el desenvolupament de la prova: una successió de fases entre el Passi de llista i la Classificació final. S’ajusta en crear la prova i a Organització ▸ Fórmula. Cada bloc té un enllaç «?» a l’editor.',
    headings: {
      pools: 'Ronda de poules',
      qualification: 'Classificació entre fases',
      quest: 'Ronda Quest',
      tableau: 'Quadre',
      'stopped-tableau': 'Quadre aturat a N',
      split: 'Divisió en competicions filles',
      waves: 'Ronda per onades',
      'team-entry': 'Inscripció per equips (parelles)',
      'ranking-filters': 'Classificacions filtrades',
      expert: 'Mode expert',
      checks: 'Controls d’estructura',
    },
    bodies: {
      pools:
        'Fins a 5 rondes seguides, cadascuna amb els seus tocs, la seva durada i la seva mida de poule. Es permeten zero rondes: el quadre es col·loca llavors segons la classificació d’entrada.',
      quest:
        'Només Sabre Làser (mode expert). Es col·loca després del Passi de llista o després d’una sola ronda de poules. Incompatible amb un quadre aturat i amb una divisió.',
      tableau:
        'Arriba fins a la final: tocs, durada, combat pel 3r lloc, tots els llocs. Res no el pot seguir.',
      'stopped-tableau':
        'Mode expert. El quadre s’atura quan queden N tiradors, que passen a una ronda de poules o a una divisió. L’avís «Passar a la fase següent» tanca l’etapa.',
      split:
        'Mode expert, sempre l’última fase. Repartiment per sexe, categoria, lloc o a mà. Cada branca esdevé una competició filla classificada a part. En la divisió per sexe, «Romandre a la prova» juga els dos quadres a la mateixa prova (competició acoblada).',
      waves:
        'Mode expert (ordre dels combats). Els combats es juguen per onades i les tauletes segueixen l’onada en curs. Poules de 2 a 10 tiradors, de 2 a 15 en onades clàssiques.',
      'team-entry':
        'Mode expert. La parella s’inscriu amb un nom d’equip, els seus dos membres i un nivell. La categoria de l’equip és la mitjana dels anys de naixement. Repartiment per nivell possible a les poules.',
      'ranking-filters':
        'Mode expert. Categoria, sexe, nivell, HANDI: la pantalla, el PDF i el CSV ofereixen una classificació filtrada, renumerada des d’1. És només una vista: la classificació publicada continua completa.',
      expert:
        'Preferència d’aquest equip, desactivada per defecte. Afegeix: divisió, ronda Quest, quadre aturat, caps de poule, empats al tall, ajustos avançats de les poules, inscripció per equips i filtres. Una fórmula que en contingui reactiva el mode durant l’edició.',
      checks:
        'L’editor assenyala en directe els errors bloquejants (S1 a S6) a la targeta de la fase: almenys una fase de combat, quadre aturat seguit d’una fase, prou tiradors, branques classificades, fase començada protegida. «Desa» continua desactivat mentre hi hagi un error.',
    },
    qualification: [
      'Tots avancen, Top %, Nombre fix, Quadre següent, Guanyador de poule.',
      'Caps de poule (expert): els primers de cada poule, després els segons, fins al nombre demanat.',
      'Empats al tall (expert): tots classificats, desempat per la classificació d’entrada o sorteig (FIE o.73.2.f). El desempat per combat queda ajornat.',
    ],
    tip: 'Guia completa de l’organitzador: docs/FORMULES.md (exemples A a G, Torneig de rapieres).',
  },
};

function sectionsOf(copy: Copy): WikiSection[] {
  const sections: WikiSection[] = [{ type: 'p', text: copy.intro }];
  for (const topic of FORMULA_HELP_TOPICS) {
    sections.push({ type: 'h2', text: copy.headings[topic], anchor: topic });
    sections.push(
      topic === 'qualification'
        ? { type: 'ul', items: [...copy.qualification] }
        : { type: 'p', text: copy.bodies[topic] }
    );
  }
  sections.push({ type: 'tip', text: copy.tip });
  return sections;
}

const langs = Object.keys(COPY) as WikiLang[];

export const FORMULA_ARTICLE: WikiArticle = {
  id: 'formula-bricks',
  icon: '🧩',
  category: 'phases',
  title: Object.fromEntries(langs.map(l => [l, COPY[l].title])) as WikiArticle['title'],
  content: Object.fromEntries(
    langs.map(l => [l, sectionsOf(COPY[l])])
  ) as unknown as WikiArticle['content'],
};

/** Articles ajoutés après ceux de wikiData.ts : formules (F5), puis articles avancés */
export const SECONDARY_ARTICLES: WikiArticle[] = [FORMULA_ARTICLE, ...ADVANCED_ARTICLES];

/**
 * BPM - Escrime - Plan de salle du planificateur d'arène enregistré sur l'épreuve (docs/adr/0025)
 * Schéma vérifié à l'entrée de saveArenaPlan ; le moteur ne l'interprète pas.
 * Licensed under GPL-3.0
 */
import { z } from 'zod';

const Coord = z.number().finite();
/** Champ saisi tel quel (nombre en texte, virgule permise) */
const Field = z.string().max(20);

const RoomItemSchema = z.object({
  id: z.string().min(1).max(64),
  kind: z.enum(['table', 'outlet', 'accessory', 'exit', 'blocked']),
  label: z.string().max(200),
  x: Coord,
  y: Coord,
  widthM: Coord.nonnegative(),
  heightM: Coord.nonnegative(),
  rotationDeg: Coord.optional(),
});

const PointSchema = z.object({ x: Coord, y: Coord });

const RoomPlanSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  width: Field,
  length: Field,
  arenas: Field,
  margin: Field,
  spacing: z.enum(['packed', 'spread']),
  align: z.enum(['left', 'center', 'right']),
  items: z.array(RoomItemSchema).max(500),
  manual: z.object({ key: z.string().max(200), centers: z.array(PointSchema).max(200) }).nullable(),
  x: Coord,
  y: Coord,
});

export const ArenaPlanSchema = z.object({
  version: z.literal(1),
  rooms: z.array(RoomPlanSchema).min(1).max(50),
  activeRoomId: z.string().max(64).optional(),
});

export type ArenaPlan = z.infer<typeof ArenaPlanSchema>;

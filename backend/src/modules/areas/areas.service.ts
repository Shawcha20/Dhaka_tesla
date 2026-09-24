import type { Area } from '@prisma/client';

import { AppError } from '../../lib/errors.js';
import { initialBearingDeg, type Coordinates } from '../../lib/geo.js';
import { prisma } from '../../lib/prisma.js';

export interface AreaDto {
  id: number;
  name: string;
  latitude: string;
  longitude: string;
}

/**
 * Prisma returns DECIMAL as its own Decimal type, whose toJSON emits a string.
 * Mapped explicitly so the wire shape is a deliberate contract rather than
 * whatever the ORM happened to produce.
 */
function toDto(area: Area): AreaDto {
  return {
    id: area.id,
    name: area.name,
    latitude: area.latitude.toFixed(6),
    longitude: area.longitude.toFixed(6),
  };
}

/** Coordinates as plain numbers, for the geo and fare calculations. */
export function toCoordinates(area: Area): Coordinates {
  return { latitude: area.latitude.toNumber(), longitude: area.longitude.toNumber() };
}

export async function listAreas(): Promise<AreaDto[]> {
  const areas = await prisma.area.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });
  return areas.map(toDto);
}

/**
 * Loads a pickup/dropoff pair in one query and validates the relationship
 * between them.
 *
 * Both areas are fetched together rather than one at a time: it is a single round
 * trip, and it means "one of these ids does not exist" is answered before any
 * geometry is attempted.
 */
export async function loadRoute(
  pickupAreaId: number,
  dropoffAreaId: number,
): Promise<{ pickup: Area; dropoff: Area; bearingDeg: number }> {
  if (pickupAreaId === dropoffAreaId) {
    throw new AppError('SAME_PICKUP_AND_DROPOFF');
  }

  const areas = await prisma.area.findMany({
    where: { id: { in: [pickupAreaId, dropoffAreaId] }, isActive: true },
  });

  const pickup = areas.find((a) => a.id === pickupAreaId);
  const dropoff = areas.find((a) => a.id === dropoffAreaId);

  if (!pickup || !dropoff) {
    throw new AppError('AREA_NOT_FOUND', {
      message: 'Pickup or destination area does not exist.',
      context: { pickupAreaId, dropoffAreaId, found: areas.map((a) => a.id) },
    });
  }

  return {
    pickup,
    dropoff,
    bearingDeg: initialBearingDeg(toCoordinates(pickup), toCoordinates(dropoff)),
  };
}

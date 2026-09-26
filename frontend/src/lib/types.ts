/**
 * Wire types for the API.
 *
 * Hand-written rather than generated, and deliberately so: they are the contract
 * this client depends on, and writing them out makes an unintended backend change
 * show up as a compile error here instead of as `undefined` at runtime.
 *
 * Every monetary field is an integer count of **paisa**. 100 paisa = 1 BDT.
 * Formatting happens only in `lib/format.ts`.
 */

export type Role = 'PASSENGER' | 'DRIVER';

export type RideStatus =
  | 'REQUESTED'
  | 'MATCHED'
  | 'DRIVER_ARRIVED'
  | 'STARTED'
  | 'COMPLETED'
  | 'CANCELLED';

export type PoolStatus =
  | 'FORMING'
  | 'DRIVER_ARRIVED'
  | 'STARTED'
  | 'COMPLETED'
  | 'CANCELLED';

export type PaymentMethod = 'CASH' | 'TESLAPAY';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED';

export type ActorRole = Role | 'SYSTEM';

export interface Area {
  id: number;
  name: string;
  latitude: string;
  longitude: string;
}

export interface Vehicle {
  id: number;
  name: string;
  plateNo: string;
  capacity: number;
  isOnline: boolean;
}

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  vehicle: Vehicle | null;
  walletBalancePaisa: number | null;
}

export interface FareBreakdown {
  baseFarePaisa: number;
  distanceChargePaisa: number;
  poolDiscountPaisa: number;
  perSeatFarePaisa: number;
  seats: number;
}

export interface Quote {
  distanceKm: string;
  breakdown: FareBreakdown;
  soloFarePaisa: number;
  estimatedPooledFarePaisa: number;
}

export interface AreaRef {
  id: number;
  name: string;
}

export interface TimelineEntry {
  fromStatus: string | null;
  toStatus: string;
  at: string;
  by: string;
  actorRole: ActorRole;
  note: string | null;
}

export interface Companion {
  name: string;
  dropoffArea: string;
  seats: number;
}

export interface RidePool {
  id: number;
  status: PoolStatus;
  seatsTaken: number;
  capacity: number;
  vehicle: { name: string; plateNo: string };
  driver: { name: string; phone: string | null };
  companions: Companion[];
}

export interface RideDetail {
  id: number;
  status: RideStatus;
  seats: number;
  pickupArea: AreaRef;
  dropoffArea: AreaRef;
  distanceKm: string;
  estimatedFarePaisa: number;
  /** The live pooled figure before departure, the locked one afterwards. */
  currentFarePaisa: number;
  finalFarePaisa: number | null;
  paymentMethod: PaymentMethod;
  cancelReason: string | null;
  requestedAt: string;
  matchedAt: string | null;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  pool: RidePool | null;
  timeline: TimelineEntry[];
}

export interface RideSummary {
  id: number;
  status: RideStatus;
  seats: number;
  pickupArea: AreaRef;
  dropoffArea: AreaRef;
  distanceKm: string;
  estimatedFarePaisa: number;
  finalFarePaisa: number | null;
  paymentMethod: PaymentMethod;
  pooled: boolean;
  requestedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
}

export type PoolabilityReason =
  | 'POOL_NOT_FORMING'
  | 'DIFFERENT_PICKUP_AREA'
  | 'NOT_ENOUGH_SEATS'
  | 'ROUTE_NOT_COMPATIBLE';

export interface Poolability {
  eligible: boolean;
  bearingDiffDeg: number | null;
  reason: PoolabilityReason | null;
  freeSeats: number;
}

export interface DriverRequest {
  id: number;
  passenger: { name: string };
  pickupArea: AreaRef;
  dropoffArea: AreaRef;
  seats: number;
  distanceKm: string;
  estimatedFarePaisa: number;
  pooledFarePaisa: number;
  bearingDeg: number;
  waitingSeconds: number;
  poolable: Poolability;
}

export interface PoolMemberView {
  rideRequestId: number;
  status: RideStatus;
  passenger: { id: number; name: string; phone: string | null };
  dropoffArea: AreaRef;
  seats: number;
  distanceKm: string;
  farePaisa: number;
  finalFarePaisa: number | null;
  paymentMethod: PaymentMethod;
  joinedAt: string;
  leftAt: string | null;
  active: boolean;
}

export interface PoolDetail {
  id: number;
  status: PoolStatus;
  seatsTaken: number;
  capacity: number;
  freeSeats: number;
  vehicle: { name: string; plateNo: string; capacity: number };
  pickupArea: AreaRef;
  createdAt: string;
  arrivedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  members: PoolMemberView[];
  totalFarePaisa: number;
  timeline: { fromStatus: string | null; toStatus: string; at: string; note: string | null }[];
}

export interface SettlementLine {
  rideRequestId: number;
  passengerName: string;
  method: PaymentMethod;
  amountPaisa: number;
  status: PaymentStatus;
  failureReason?: 'INSUFFICIENT_WALLET_BALANCE';
}

export interface TripHistoryEntry {
  id: number;
  status: PoolStatus;
  pickupArea: AreaRef;
  vehicle: { name: string; plateNo: string };
  capacity: number;
  seatsUsed: number;
  utilisationPct: number;
  passengerCount: number;
  pooled: boolean;
  earnedPaisa: number;
  passengers: {
    name: string;
    dropoffArea: string;
    seats: number;
    farePaisa: number;
    paymentStatus: PaymentStatus | null;
    paymentMethod: PaymentMethod | null;
  }[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
}

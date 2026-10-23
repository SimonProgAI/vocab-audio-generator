import type { QueueItem } from "../types/queue";

export const MIN_SPEED = 0.5;
export const MAX_SPEED = 2.0;
export const SPEED_STEP = 0.1;
export const DEFAULT_SPEED = 1.0;

/** Rounds to one decimal place, matching SPEED_STEP, to avoid floating-point drift. */
export function roundSpeed(speed: number): number {
  return Math.round(speed * 10) / 10;
}

export const SPEED_OPTIONS: readonly number[] = Array.from(
  { length: Math.round((MAX_SPEED - MIN_SPEED) / SPEED_STEP) + 1 },
  (_, index) => roundSpeed(MIN_SPEED + index * SPEED_STEP),
);

export function formatSpeed(speed: number): string {
  return `${speed.toFixed(1)}×`;
}

export function effectiveSpeed(
  item: Pick<QueueItem, "speed" | "overrideSpeed">,
  globalSpeed: number,
): number {
  return item.overrideSpeed ? item.speed : globalSpeed;
}

export interface MapShelf {
  id: string;
  code: string;
  description: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface FloorMap {
  revision: number;
  width: number;
  height: number;
  shelves: MapShelf[];
}
export function validateFloorMap(input: unknown): FloorMap;
export function assertShelfContinuity(previous: FloorMap | null, next: FloorMap): void;

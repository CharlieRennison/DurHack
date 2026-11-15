// Shared contracts. Changes need team agreement (see CLAUDE.md).

export type NodeKind = 'folder' | 'file' | 'function';

/** data -> layout */
export interface RepoNode {
  id: string;
  kind: NodeKind;
  name: string;
  path: string;
  size: number;
  children: RepoNode[];
}

export type TileType =
  | 'ocean'
  | 'island'
  | 'coast'
  | 'port'
  | 'coral'
  | 'village'
  | 'house'
  | 'tree';

export interface Tile {
  type: TileType;
  variant: number;
  height: number;
  /** A tile with nodeId is zoomable into that node. */
  nodeId?: string;
  // Territories: an 'ocean' tile that has a nodeId is that child's territory water (the shallow ring round its
  // islet, or the reef water of a coral). It is zoomable into that node like any other tile with a nodeId.
  // On ocean tiles `variant` means depth: 0 = deep, 1 = shallow (inside a cluster), 2 = reef.
}

/** layout -> render. Indexed grid[y][x]. */
export type Grid = Tile[][];

export const GRID_SIZE = 48;
export const MAX_ISLAND_DEPTH = 4;

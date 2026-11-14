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
}

/** layout -> render. Indexed grid[y][x]. */
export type Grid = Tile[][];

export const GRID_SIZE = 32;
export const MAX_ISLAND_DEPTH = 4;

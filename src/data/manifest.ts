/** Shared by the Node CLI and the browser loader. Types only: safe to import anywhere. */
export interface ManifestEntry {
  /** "<owner>__<repo>", also the JSON file stem. */
  id: string;
  owner: string;
  repo: string;
  url: string;
  ref?: string;
  /** Commit SHA the JSON was generated from. */
  commit: string;
  /** JSON file name inside public/demo/. */
  file: string;
  nodes: number;
  files: number;
  functions: number;
  /** The app opens this repo first (falls back to the first entry, then to mock.json). */
  default?: boolean;
}

export interface Manifest {
  repos: ManifestEntry[];
}

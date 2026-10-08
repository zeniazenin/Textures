export interface Photo {
  id: string;
  no: number;
  source: string;
  title: string;
  tags: string[];
  featured: boolean;
  width: number;
  height: number;
  aspect: number;
  takenAt: string | null;
  color: string;
  hue: number;
  chroma: number;
  lightness: number;
  neutral: boolean;
  blurhash: string;
  seed: number;
  sizes: Record<string, { w: number; h: number }>;
}

export interface Band { label: string; start: number; count: number }

export interface Manifest {
  generatedAt: string;
  site: {
    name: string; tagline: string; description: string;
    footer: { copyright: string; contact: string; contactUrl?: string };
    heroEyebrowTags: string; accent: string; featured: string | null;
  };
  sizes: Record<string, number>;
  formats: string[];
  count: number;
  bands: Band[];
  tags: Record<string, number>;
  photos: Photo[];
}

export type Size = 'sliver' | 'thumb' | 'medium' | 'tex' | 'large';

export interface KaleidoParams {
  mirrors: number; // even, 4..32
  zoom: number;    // 1.2..4
  speed: number;   // deg/s
  paused: boolean;
  seed: number;
}

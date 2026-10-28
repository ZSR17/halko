import { z } from 'zod';

export const API_PREFIX = '/api/v1';

export const loginBody = z.object({
  password: z.string().min(1).max(200),
  deviceName: z.string().min(1).max(80),
});
export type LoginBody = z.infer<typeof loginBody>;

export interface LoginResponse {
  token: string;
  deviceId: string;
}

export interface HealthResponse {
  ok: boolean;
  version: string;
}

// Upload limit for photos, GIFs and videos (they are compressed on the server).
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

// Part of a photo to keep, chosen in the app, as fractions of its width and height (0 to 1).
export const crop = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().gt(0).max(1),
    h: z.number().gt(0).max(1),
  })
  .refine((c) => c.x + c.w <= 1.001 && c.y + c.h <= 1.001);
export type Crop = z.infer<typeof crop>;

export interface UploadResponse {
  // Media to append to an exercise: [image] for a photo, [video, poster image] for a GIF or video.
  ids: string[];
  urls: string[];
}

export interface StorageResponse {
  media: { files: number; bytes: number };
  databaseBytes: number;
}

// Server-side media URL: images are WebP, animations and videos MP4.
export function mediaUrl(id: string, mime: string): string {
  return `/media/${id}.${mime === 'video/mp4' ? 'mp4' : 'webp'}`;
}

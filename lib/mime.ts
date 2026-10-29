export const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus', // Chrome / Android / Firefox
  'audio/mp4', // iOS Safari
  'audio/ogg;codecs=opus',
];

export function pickRecorderMime(isSupported: (type: string) => boolean): string {
  return RECORDER_MIME_CANDIDATES.find((t) => isSupported(t)) ?? '';
}

const baseType = (mime: string) => mime.split(';')[0].trim().toLowerCase();

const EXTENSIONS: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'mp4',
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
};

export function extensionForMime(mime: string): string {
  return EXTENSIONS[baseType(mime)] ?? 'bin';
}

export function isAllowedUploadMime(mime: string): boolean {
  return baseType(mime) in EXTENSIONS;
}

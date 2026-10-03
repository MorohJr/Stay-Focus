/** Browser/platform helpers (SPEC 5.9, 3.11). */

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Saves text as a file. On iPhone the share sheet ("Save to Files") is the reliable way. */
export async function saveFile(fileName: string, text: string, mime = 'application/json'): Promise<void> {
  const file = new File([text], fileName, { type: mime });
  if (isIos() && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] });
    return;
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Shrinks a photo to at most 1600px on the long side (SPEC 3.11). Logos stay PNG to keep transparency. */
export async function shrinkImage(file: File | Blob, maxSide = 1600, mime: 'image/jpeg' | 'image/png' = 'image/jpeg'): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), mime, 0.85));
  } catch {
    return file;
  }
}

/** Current position for the weather location (asks permission). */
export function currentPosition(): Promise<{ lat: number; lon: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('no_geolocation'));
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }), reject, { timeout: 10_000, maximumAge: 600_000 });
  });
}

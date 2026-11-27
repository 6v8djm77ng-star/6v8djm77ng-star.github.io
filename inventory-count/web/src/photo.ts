/**
 * Shrinks a camera photo on the device before upload: phone photos are 3–8MB,
 * a warehouse Wi-Fi does not need that. Result: JPEG, longest side ≤ 1600px, typically 150–400KB.
 */
export async function compressPhoto(file: File, maxSide = 1600, quality = 0.8): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('הקובץ שנבחר אינו תמונה');
  const url = URL.createObjectURL(file);
  try {
    // <img> decoding applies EXIF orientation in current browsers, so the photo is not rotated.
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('לא הצלחנו לקרוא את התמונה'));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('הדפדפן לא תומך בעיבוד תמונה');
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

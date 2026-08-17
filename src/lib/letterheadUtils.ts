import * as pdfjsLib from 'pdfjs-dist';

// Configure pdfjs worker using reliable jsdelivr or unpkg CDN
if (typeof window !== 'undefined') {
  try {
    const version = pdfjsLib.version || '4.10.38';
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${version}/build/pdf.worker.min.mjs`;
  } catch (e) {
    console.warn('Could not set pdf workerSrc', e);
  }
}

/**
 * Converts a PDF ArrayBuffer or base64 to a high-resolution JPEG image (A4 letterhead page 1)
 */
export async function convertPdfPageToImage(pdfData: ArrayBuffer | Uint8Array | string): Promise<string> {
  let data: ArrayBuffer | Uint8Array;

  if (typeof pdfData === 'string') {
    if (pdfData.startsWith('data:application/pdf;base64,')) {
      const base64 = pdfData.replace(/^data:application\/pdf;base64,/, '');
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      data = bytes;
    } else {
      throw new Error('Unsupported PDF string format');
    }
  } else {
    data = pdfData;
  }

  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);

  // Target standard high-res crisp width ~1500px for optimal A4 print quality without exceeding Firestore limits
  const unscaledViewport = page.getViewport({ scale: 1.0 });
  const targetWidth = 1500;
  const scale = targetWidth / unscaledViewport.width;
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Canvas 2D context unavailable');
  }

  // Pre-fill white background so transparent PDFs don't appear black
  context.fillStyle = '#FFFFFF';
  context.fillRect(0, 0, canvas.width, canvas.height);

  const renderContext: any = {
    canvasContext: context,
    viewport: viewport,
    canvas: canvas,
  };

  await page.render(renderContext).promise;

  return canvas.toDataURL('image/jpeg', 0.88);
}

/**
 * Optimizes an uploaded image file to max 1500px JPEG to fit within storage limits and print crisply
 */
export function optimizeImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const maxDim = 1500;
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.src = e.target?.result as string;
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Universal file processor: accepts PDF or Image, returning a standard JPEG data URL
 */
export async function processLetterheadFile(file: File): Promise<{ dataUrl: string; isPdfConverted: boolean }> {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const arrayBuffer = await file.arrayBuffer();
    const dataUrl = await convertPdfPageToImage(arrayBuffer);
    return { dataUrl, isPdfConverted: true };
  } else if (file.type.startsWith('image/')) {
    const dataUrl = await optimizeImageFile(file);
    return { dataUrl, isPdfConverted: false };
  } else {
    throw new Error('Unsupported file type. Please upload a PDF or Image (PNG/JPG/WebP).');
  }
}

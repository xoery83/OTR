export type CompressedImage = {
  blob: Blob;
  width: number;
  height: number;
  previewUrl: string;
  thumbnailBlob: Blob;
  thumbnailWidth: number;
  thumbnailHeight: number;
};

const maxOriginalBytes = 20 * 1024 * 1024;
const maxDimension = 1920;
const thumbnailMaxDimension = 480;
const jpegQuality = 0.85;
const thumbnailJpegQuality = 0.72;

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("This image format is not supported by your browser."));
    };

    image.src = objectUrl;
  });
}

function getScaledDimensions(width: number, height: number, maxSide = maxDimension) {
  const longestSide = Math.max(width, height);

  if (longestSide <= maxSide) {
    return { width, height };
  }

  const scale = maxSide / longestSide;

  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

async function renderImageBlob(
  image: HTMLImageElement,
  dimensions: { width: number; height: number },
  quality: number,
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Your browser could not prepare the image.");
  }

  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  context.drawImage(image, 0, 0, dimensions.width, dimensions.height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });

  if (!blob) {
    throw new Error("Your browser could not compress this image.");
  }

  return blob;
}

export async function compressImageFile(file: File): Promise<CompressedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please choose an image file.");
  }

  if (file.size > maxOriginalBytes) {
    throw new Error("Please choose an image smaller than 20MB.");
  }

  const image = await loadImage(file);
  const dimensions = getScaledDimensions(image.naturalWidth, image.naturalHeight);
  const thumbnailDimensions = getScaledDimensions(
    image.naturalWidth,
    image.naturalHeight,
    thumbnailMaxDimension,
  );
  const [blob, thumbnailBlob] = await Promise.all([
    renderImageBlob(image, dimensions, jpegQuality),
    renderImageBlob(image, thumbnailDimensions, thumbnailJpegQuality),
  ]);

  return {
    blob,
    width: dimensions.width,
    height: dimensions.height,
    previewUrl: URL.createObjectURL(blob),
    thumbnailBlob,
    thumbnailWidth: thumbnailDimensions.width,
    thumbnailHeight: thumbnailDimensions.height,
  };
}

export function makeSafeFileName(fileName: string) {
  const baseName = fileName
    .replace(/\.[^.]+$/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${baseName || "photo"}.jpg`;
}

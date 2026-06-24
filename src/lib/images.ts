export type CompressedImage = {
  blob: Blob;
  width: number;
  height: number;
  previewUrl: string;
};

const maxOriginalBytes = 20 * 1024 * 1024;
const maxDimension = 1920;
const jpegQuality = 0.85;

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

function getScaledDimensions(width: number, height: number) {
  const longestSide = Math.max(width, height);

  if (longestSide <= maxDimension) {
    return { width, height };
  }

  const scale = maxDimension / longestSide;

  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
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
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Your browser could not prepare the image.");
  }

  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  context.drawImage(image, 0, 0, dimensions.width, dimensions.height);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", jpegQuality);
  });

  if (!blob) {
    throw new Error("Your browser could not compress this image.");
  }

  return {
    blob,
    width: dimensions.width,
    height: dimensions.height,
    previewUrl: URL.createObjectURL(blob),
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

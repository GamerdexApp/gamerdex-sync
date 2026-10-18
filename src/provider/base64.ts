const CHUNK = 0x8000;

/** Encodes text as base64 from its UTF-8 bytes. It works in the browser and in Node. */
export const encodeBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
};

/** Decodes base64 to text. Line breaks in the base64 text are ignored. */
export const decodeBase64 = (base64: string): string => {
  const binary = atob(base64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
};

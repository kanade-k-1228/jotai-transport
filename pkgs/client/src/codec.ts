export type Frame = string | ArrayBuffer | ArrayBufferView;

export interface Codec {
  encode(payload: Record<string, unknown>): Frame;
  decode(frame: Frame): unknown;
}

export const jsonCodec: Codec = {
  encode: (payload) => JSON.stringify(payload),
  decode: (frame) => (typeof frame === 'string' ? JSON.parse(frame) : null),
};

export const toBytes = (frame: Frame): Uint8Array | null =>
  typeof frame === 'string'
    ? null
    : frame instanceof ArrayBuffer
      ? new Uint8Array(frame)
      : new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength);

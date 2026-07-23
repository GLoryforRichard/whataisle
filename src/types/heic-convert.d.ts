declare module 'heic-convert' {
  function heicConvert(opts: {
    buffer: Buffer;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }): Promise<ArrayBuffer>;
  export default heicConvert;
}

declare module 'heic-decode' {
  interface Decoded {
    width: number
    height: number
    data: Uint8ClampedArray
  }
  function decode(input: { buffer: Uint8Array }): Promise<Decoded>
  export default decode
}

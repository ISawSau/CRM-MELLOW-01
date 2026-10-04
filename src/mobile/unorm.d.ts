declare module 'unorm' {
  const unorm: {
    nfc(s: string): string
    nfd(s: string): string
    nfkc(s: string): string
    nfkd(s: string): string
  }
  export default unorm
}

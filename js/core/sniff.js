// Quick look at the first bytes, to give a kind message when a file is not what its name says.
export function isZip(bytes) {
  return bytes.length > 3 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 3 || bytes[2] === 5);
}
// Old Word/Excel (.doc/.xls) and password-protected Office files share this header.
export function isOleOffice(bytes) {
  return bytes.length > 7 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

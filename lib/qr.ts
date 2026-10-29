import QRCode from 'qrcode';

export const qrDataUrl = (text: string) =>
  QRCode.toDataURL(text, { margin: 1, width: 360, color: { dark: '#3b2f25', light: '#fffdf8' } });

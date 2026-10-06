'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Download } from 'lucide-react';
export function QrPass({
  token,
  code,
  payload,
}: {
  token?: string;
  code: string;
  payload?: string;
}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    QRCode.toDataURL(payload || `FARLANDS:${token}`, {
      width: 800,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#091015', light: '#ffffff' },
    })
      .then(setUrl)
      .catch(() => setError('Could not generate QR image. Please reload.'));
  }, [token, payload]);
  return (
    <div className="center stack" style={{ justifyItems: 'center' }}>
      {error ? (
        <p role="alert">{error}</p>
      ) : url ? (
        <div className="qr">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt={`QR code for ${code}`} />
        </div>
      ) : (
        <p>Generating QR…</p>
      )}
      <strong className="mono">{code}</strong>
      {url && (
        <a className="button primary" href={url} download={`${code}.png`}>
          <Download size={16} />
          Download QR
        </a>
      )}
    </div>
  );
}

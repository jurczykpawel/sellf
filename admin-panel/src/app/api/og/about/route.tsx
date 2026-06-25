import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const locale = url.searchParams.get('locale') === 'pl' ? 'pl' : 'en';

  const headline =
    locale === 'pl'
      ? 'Sprzedawaj produkty cyfrowe bez prowizji'
      : 'Sell digital products without platform fees';
  const subhead =
    locale === 'pl'
      ? 'Self-hosted. Source-available. 0 PLN miesięcznie.'
      : 'Self-hosted. Source-available. $0 per month.';

  return new ImageResponse(
    (
      <div
        style={{
          height: '100%',
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          justifyContent: 'center',
          background:
            'linear-gradient(135deg, #050B16 0%, #0A1530 50%, #06223A 100%)',
          padding: '80px',
          color: '#FFFFFF',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            fontSize: 28,
            color: '#7FBEE0',
            letterSpacing: 4,
            marginBottom: 20,
          }}
        >
          SELLF
        </div>
        <div
          style={{
            fontSize: 64,
            fontWeight: 900,
            lineHeight: 1.05,
            maxWidth: 1000,
          }}
        >
          {headline}
        </div>
        <div
          style={{
            fontSize: 32,
            marginTop: 30,
            color: '#9FC9E8',
            maxWidth: 1000,
          }}
        >
          {subhead}
        </div>
        <div style={{ fontSize: 22, marginTop: 60, color: '#5B89A8' }}>
          sellf.app
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}

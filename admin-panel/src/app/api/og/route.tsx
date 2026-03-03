import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          background: '#0B1120',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '80px',
          position: 'relative',
          fontFamily: 'sans-serif',
          overflow: 'hidden',
        }}
      >
        {/* Background glow — top right */}
        <div
          style={{
            position: 'absolute',
            top: -160,
            right: -160,
            width: 640,
            height: 640,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(0,120,187,0.22) 0%, transparent 70%)',
          }}
        />

        {/* Background glow — bottom left */}
        <div
          style={{
            position: 'absolute',
            bottom: -200,
            left: -100,
            width: 500,
            height: 500,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(0,120,187,0.10) 0%, transparent 70%)',
          }}
        />

        {/* Logo mark + name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginBottom: 36 }}>
          <div
            style={{
              width: 60,
              height: 60,
              background: '#0078BB',
              borderRadius: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <span style={{ color: '#fff', fontSize: 34, fontWeight: 800 }}>S</span>
          </div>
          <span style={{ color: '#F0F4FA', fontSize: 48, fontWeight: 800, letterSpacing: '-1.5px' }}>
            Sellf
          </span>
        </div>

        {/* Main headline */}
        <div
          style={{
            color: '#F0F4FA',
            fontSize: 52,
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: '-1.5px',
            marginBottom: 20,
            maxWidth: 820,
          }}
        >
          {'Sell digital products.\nKeep 100% of revenue.'}
        </div>

        {/* Subheadline */}
        <div
          style={{
            color: '#94A3B8',
            fontSize: 22,
            fontWeight: 400,
            lineHeight: 1.5,
            marginBottom: 52,
            maxWidth: 680,
          }}
        >
          Self-hosted platform for courses, ebooks and digital content.
          No per-sale fees. No lock-in.
        </div>

        {/* Feature badges */}
        <div style={{ display: 'flex', gap: 10 }}>
          {['Self-hosted', 'No commission', 'Magic link auth', 'Stripe payments'].map((feat) => (
            <div
              key={feat}
              style={{
                background: 'rgba(0,120,187,0.10)',
                border: '1px solid rgba(0,120,187,0.28)',
                color: '#94A3B8',
                fontSize: 15,
                fontWeight: 500,
                padding: '7px 14px',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <span style={{ color: '#0078BB', fontSize: 13 }}>✓</span>
              {feat}
            </div>
          ))}
        </div>

        {/* URL — bottom right */}
        <div
          style={{
            position: 'absolute',
            bottom: 44,
            right: 80,
            color: '#4A5A70',
            fontSize: 17,
            fontWeight: 500,
            letterSpacing: '0.3px',
          }}
        >
          sellf.app
        </div>

        {/* Bottom accent line */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 3,
            background: 'linear-gradient(90deg, #0078BB 0%, rgba(0,120,187,0.3) 50%, transparent 80%)',
          }}
        />
      </div>
    ),
    { width: 1200, height: 630 }
  );
}

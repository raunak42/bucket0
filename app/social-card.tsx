import { ImageResponse } from "next/og";

function BucketMark() {
  return (
    <svg width="220" height="220" viewBox="0 0 550.9 550.9" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path fill="#111111" d="M275.15 133.5c-102.2 0-185.4 28.8-185.4 63.6l43.5 304.8c0 26.899 63.6 49 142 49 78.4 0 142-22 142-49l42.8-304.8c0-35.4-83.199-63.6-185.4-63.6Zm0 108.3c-53.9 0-102.2-8-136.5-20.8l42.2 299.9c-6.7-1.801-12.9-4.301-18.4-6.7l-42.8-301.7c-6.1-3.1-11.6-6.7-15.9-10.4 28.2-22.6 94.2-39.2 170.7-39.2 76.5 0 142.6 15.9 170.7 39.2-27.4 23.2-92.9 39.7-170 39.7ZM469.15 169c-3.101-4.3-6.7-8.6-11-11.6-8-6.7-17.7-12.2-28.2-16.5-19.6-63.1-77.7-108.4-147.5-108.4h-14c-69.8 0-127.9 45.3-147.5 108.3-11 4.9-20.2 9.8-28.2 16.5-4.3 3.7-8 7.3-11 11.6C90.35 74 169.85 0 267.15 0h16.5c96.8.1 176.3 74.2 185.5 169Z" />
    </svg>
  );
}

export function createSocialCard({ title, description }: { title: string; description: string }) {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#ffffff",
          color: "#111111",
          fontFamily: "sans-serif",
          padding: "56px 64px",
          border: "1px solid #e5e7eb",
        }}
      >
        <div
          style={{
            display: "flex",
            width: "100%",
            height: "100%",
            border: "1px solid #e5e7eb",
            borderRadius: 28,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: 360,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "#f8fafc",
              borderRight: "1px solid #e5e7eb",
            }}
          >
            <BucketMark />
          </div>

          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              padding: "56px",
              background: "#ffffff",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                fontSize: 28,
                fontWeight: 600,
                color: "#111111",
              }}
            >
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 9999,
                  background: "#111111",
                }}
              />
              Bucket0
            </div>

            <div
              style={{
                marginTop: 24,
                fontSize: 68,
                lineHeight: 1.02,
                fontWeight: 700,
                letterSpacing: "-0.04em",
              }}
            >
              {title}
            </div>

            <div
              style={{
                marginTop: 24,
                fontSize: 28,
                lineHeight: 1.45,
                color: "#4b5563",
                maxWidth: 620,
              }}
            >
              {description}
            </div>

            <div
              style={{
                marginTop: 36,
                display: "flex",
                gap: 16,
                fontSize: 22,
                color: "#6b7280",
              }}
            >
              <span>Next.js</span>
              <span>•</span>
              <span>Better Auth</span>
              <span>•</span>
              <span>Prisma</span>
              <span>•</span>
              <span>S3 / R2 / Wasabi</span>
            </div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
    },
  );
}

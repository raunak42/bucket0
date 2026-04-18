import { createSocialCard } from "./social-card";

export const alt = "Bucket0";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function TwitterImage() {
  return createSocialCard({
    title: "Bucket0",
    description:
      "Bucket0 is a modern storage dashboard for managed files and external S3-compatible buckets.",
  });
}

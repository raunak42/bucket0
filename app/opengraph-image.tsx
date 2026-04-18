import { createSocialCard } from "./social-card";

export const alt = "Bucket0";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return createSocialCard({
    title: "Modern file storage for S3-compatible buckets",
    description:
      "A polished file dashboard with managed storage, external bucket connections, uploads, previews, and a responsive explorer UI.",
  });
}

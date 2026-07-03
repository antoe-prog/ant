import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "파이널 유도 멀티짐",
    short_name: "파이널 유도",
    description: "유도장과 멀티짐의 수업, 출석, 결제, 공지를 역할별로 확인합니다.",
    lang: "ko-KR",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f7f9fb",
    theme_color: "#102a43",
    categories: ["business", "productivity", "sports"],
    icons: [
      {
        src: "/icons/final-judo-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/final-judo-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      {
        name: "출석 체크",
        short_name: "출석",
        description: "코치용 수업별 출석 체크 화면으로 이동",
        url: "/app/classes",
        icons: [{ src: "/icons/final-judo-icon-192.png", sizes: "192x192" }],
      },
      {
        name: "운영 대시보드",
        short_name: "대시보드",
        description: "역할별 핵심 운영 지표 화면으로 이동",
        url: "/app/dashboard",
        icons: [{ src: "/icons/final-judo-icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}

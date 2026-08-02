import type { NextConfig } from "next";
const isGitHubPages=process.env.GITHUB_PAGES==="true";
const basePath=process.env.PAGES_BASE_PATH??"";
const nextConfig:NextConfig={...(isGitHubPages?{output:"export" as const,trailingSlash:true,basePath,assetPrefix:basePath}:{})};
export default nextConfig;

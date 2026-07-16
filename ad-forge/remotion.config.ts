import { Config } from "@remotion/cli/config";

Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// H.264 that plays everywhere (Meta/IG/TikTok friendly).
Config.setCodec("h264");
Config.setPixelFormat("yuv420p");
Config.setEntryPoint("./remotion/index.ts");
// This box OOMs Chrome at high concurrency on 1080x1920 frames.
Config.setConcurrency(2);
Config.setChromiumDisableWebSecurity(true);

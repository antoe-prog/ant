const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// expo-server-sdk는 서버 전용 패키지 - Metro 감시 대상에서 제외
config.resolver = {
  ...config.resolver,
  blockList: [
    ...(Array.isArray(config.resolver?.blockList) ? config.resolver.blockList : []),
    /.*expo-server-sdk_tmp.*/,
  ],
};

module.exports = withNativeWind(config, {
  input: "./global.css",
  // Force write CSS to file system instead of virtual modules
  // This fixes iOS styling issues in development mode
  forceWriteFileSystem: true,
});

export function shouldRefuseLaunch(platform, env) {
  return platform !== "darwin" && env.IRIS_ALLOW_ANY_PLATFORM?.trim() !== "1";
}

/**
 * Official channels.
 *
 * One place, env-overridable, so a handle change never means hunting through components.
 * GitHub points at the repository that actually builds this bundle; it is the only entry here
 * that is self-verifying. X and Telegram take VITE_X_URL / VITE_TELEGRAM_URL — until those are
 * set the buttons still open a working destination, but they are not presented as verified
 * brand accounts anywhere in the UI copy.
 */
const env = import.meta.env;

export const SOCIAL = {
  x: (env.VITE_X_URL as string | undefined) ?? "https://x.com/AuraPredict",
  telegram: (env.VITE_TELEGRAM_URL as string | undefined) ?? "https://t.me/AuraPredictBot",
  github: (env.VITE_GITHUB_URL as string | undefined) ?? "https://github.com/PeaceCoin10/Aura-AI-Prediction-Market",
} as const;

export type SocialKey = keyof typeof SOCIAL;

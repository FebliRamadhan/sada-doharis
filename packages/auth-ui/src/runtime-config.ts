/**
 * Runtime configuration, fetched once at startup from GET /auth/config.
 *
 * Deliberately NOT a VITE_* build-time constant: the whole point of the
 * REGISTRATION_ENABLED kill-switch is that flipping it in the server env and
 * restarting auth-service is enough. Baking it into the bundle would make the
 * UI disagree with the backend until the image is rebuilt.
 *
 * Fails closed: if the fetch errors out, registration is treated as disabled,
 * so a hiccup can never expose a signup path that the server would reject.
 */
import { endpoints } from './api';

export interface RuntimeConfig {
  registrationEnabled: boolean;
}

const FALLBACK: RuntimeConfig = { registrationEnabled: false };

let config: RuntimeConfig = FALLBACK;

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const response = await fetch(endpoints.config, { credentials: 'include' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const body = (await response.json()) as {
      success?: boolean;
      data?: { registration_enabled?: boolean };
    };

    config = { registrationEnabled: body.data?.registration_enabled === true };
  } catch {
    config = FALLBACK;
  }

  return config;
}

export function getRuntimeConfig(): RuntimeConfig {
  return config;
}

export function isRegistrationEnabled(): boolean {
  return config.registrationEnabled;
}

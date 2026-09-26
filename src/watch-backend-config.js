function requiredString(environment, name) {
  const value = environment?.[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

export function loadWatchBackendConfig(environment = {}, { requireSendingSecrets = false } = {}) {
  const allowedOrigins = requiredString(environment, 'WATCH_ALLOWED_ORIGINS')
    .split(',').map(origin => origin.trim()).filter(Boolean);
  for (const origin of allowedOrigins) {
    let url;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('WATCH_ALLOWED_ORIGINS must contain exact HTTP(S) origins');
    }
    if (url.origin !== origin || !['https:', 'http:'].includes(url.protocol)) {
      throw new Error('WATCH_ALLOWED_ORIGINS must contain exact HTTP(S) origins');
    }
  }
  if (!allowedOrigins.length) throw new Error('WATCH_ALLOWED_ORIGINS must contain at least one origin');

  const config = {
    allowedOrigins: Object.freeze([...new Set(allowedOrigins)]),
    vapidPublicKey: typeof environment.VAPID_PUBLIC_KEY === 'string' ? environment.VAPID_PUBLIC_KEY.trim() : '',
    vapidKeyVersion: typeof environment.VAPID_KEY_VERSION === 'string' ? environment.VAPID_KEY_VERSION.trim() : '',
    vapidSubject: typeof environment.VAPID_SUBJECT === 'string' ? environment.VAPID_SUBJECT.trim() : ''
  };
  if (requireSendingSecrets) {
    config.vapidPublicKey = requiredString(environment, 'VAPID_PUBLIC_KEY');
    config.vapidPrivateKey = requiredString(environment, 'VAPID_PRIVATE_KEY');
    config.vapidSubject = requiredString(environment, 'VAPID_SUBJECT');
    if (!/^(mailto:|https:\/\/)/.test(config.vapidSubject)) {
      throw new Error('VAPID_SUBJECT must be a mailto: or HTTPS URI');
    }
  }
  return Object.freeze(config);
}

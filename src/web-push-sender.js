const encoder = new TextEncoder();

function base64url(bytes) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64url(value, name) {
  if (typeof value !== 'string' || !value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new TypeError(`${name} is invalid`);
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function concat(...values) {
  const output = new Uint8Array(values.reduce((length, value) => length + value.length, 0));
  let offset = 0;
  for (const value of values) { output.set(value, offset); offset += value.length; }
  return output;
}

async function hkdf(cryptoImpl, input, salt, info, length) {
  const key = await cryptoImpl.subtle.importKey('raw', input, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await cryptoImpl.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

function vapidJwk(publicKey, privateKey) {
  const publicBytes = decodeBase64url(publicKey, 'VAPID public key');
  const privateBytes = decodeBase64url(privateKey, 'VAPID private key');
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) throw new TypeError('VAPID key material is invalid');
  return { kty: 'EC', crv: 'P-256', x: base64url(publicBytes.slice(1, 33)), y: base64url(publicBytes.slice(33)), d: base64url(privateBytes), ext: true };
}

async function vapidAuthorization(endpoint, config, cryptoImpl, nowMs) {
  const header = base64url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = base64url(encoder.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(nowMs / 1000) + 12 * 60 * 60,
    sub: config.vapidSubject
  })));
  const unsigned = `${header}.${claims}`;
  const key = await cryptoImpl.subtle.importKey('jwk', vapidJwk(config.vapidPublicKey, config.vapidPrivateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = await cryptoImpl.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned));
  return `vapid t=${unsigned}.${base64url(signature)}, k=${config.vapidPublicKey}`;
}

async function encryptPayload(subscription, payload, cryptoImpl) {
  const receiverPublic = decodeBase64url(subscription.p256dh, 'subscription p256dh');
  const auth = decodeBase64url(subscription.auth, 'subscription auth');
  if (receiverPublic.length !== 65 || receiverPublic[0] !== 4 || auth.length < 16) throw new TypeError('Subscription key material is invalid');
  const receiverKey = await cryptoImpl.subtle.importKey('raw', receiverPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const senderKeys = await cryptoImpl.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const senderPublic = new Uint8Array(await cryptoImpl.subtle.exportKey('raw', senderKeys.publicKey));
  const shared = new Uint8Array(await cryptoImpl.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, senderKeys.privateKey, 256));
  const ikm = await hkdf(cryptoImpl, shared, auth, concat(encoder.encode('WebPush: info\0'), receiverPublic, senderPublic), 32);
  const salt = cryptoImpl.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(cryptoImpl, ikm, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(cryptoImpl, ikm, salt, encoder.encode('Content-Encoding: nonce\0'), 12);
  const contentKey = await cryptoImpl.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const plaintext = concat(encoder.encode(payload), Uint8Array.of(2));
  const ciphertext = new Uint8Array(await cryptoImpl.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, contentKey, plaintext));
  const recordSize = new Uint8Array([0, 0, 16, 0]);
  return concat(salt, recordSize, Uint8Array.of(senderPublic.length), senderPublic, ciphertext);
}

export function createWebPushSender({ config, fetchImpl = fetch, cryptoImpl = crypto, now = () => Date.now() } = {}) {
  if (!config?.vapidPublicKey || !config?.vapidPrivateKey || !config?.vapidSubject) throw new Error('Complete VAPID configuration is required');
  vapidJwk(config.vapidPublicKey, config.vapidPrivateKey);
  return {
    async sendPush(subscription, payload) {
      const endpoint = new URL(subscription.endpoint);
      if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new TypeError('Push subscription endpoint is invalid');
      const body = await encryptPayload(subscription, JSON.stringify(payload), cryptoImpl);
      const authorization = await vapidAuthorization(endpoint, config, cryptoImpl, now());
      return fetchImpl(endpoint.href, {
        method: 'POST', body,
        headers: { authorization, 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '300' }
      });
    }
  };
}

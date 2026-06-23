import { json, methodNotAllowed } from '../lib/http-api.mjs';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host || '';
  const origin = host ? `${proto}://${host}` : '';
  return json(res, 200, {
    host,
    port: '',
    lanIp: '',
    pinned: false,
    urls: { local: origin ? origin + '/' : '/', loopback: origin ? origin + '/' : '/', lan: origin ? origin + '/' : '/' },
  });
}

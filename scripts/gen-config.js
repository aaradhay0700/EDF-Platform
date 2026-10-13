// Netlify build step: writes public/config.js from environment variables.
// This script NEVER fails the build: if something is wrong it logs a warning and the site shows a
// "Supabase is not configured" message instead of breaking the deploy.
// Only the public anon key belongs here - a service_role key is detected and refused.
const fs = require('fs');
const path = require('path');

// Accepts SUPABASE_URL / SUPABASE_ANON_KEY, or Project_URL / ANON_Public (case-insensitive).
const pick = (...names) => {
  for (const n of names) {
    const k = Object.keys(process.env).find((e) => e.toLowerCase() === n.toLowerCase());
    if (k && process.env[k] && process.env[k].trim()) return process.env[k].trim().replace(/^["']|["']$/g, '');
  }
  return '';
};

let url = pick('SUPABASE_URL', 'Project_URL').replace(/\/+$/, '');
let key = pick('SUPABASE_ANON_KEY', 'ANON_Public');
const problems = [];

if (!url) problems.push('SUPABASE_URL is not set');
else if (!/^https:\/\/.+/.test(url)) { problems.push('SUPABASE_URL must start with https://'); url = ''; }

if (!key) problems.push('SUPABASE_ANON_KEY is not set');
else {
  try { // JWT keys: refuse service_role
    const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString('utf8'));
    if (payload.role === 'service_role') { problems.push('SUPABASE_ANON_KEY is a service_role key - NOT published. Use the anon/public key'); key = ''; }
  } catch (_) { /* new-style sb_publishable_ keys are not JWTs; fine */ }
  if (/^sb_secret_/.test(key)) { problems.push('SUPABASE_ANON_KEY is a secret key - NOT published. Use the publishable/anon key'); key = ''; }
}

const cfg = url && key ? { SUPABASE_URL: url, SUPABASE_ANON_KEY: key } : {};
fs.writeFileSync(path.join(__dirname, '..', 'public', 'config.js'), `window.EDF_CONFIG = ${JSON.stringify(cfg)};\n`);

if (problems.length) {
  console.warn('WARNING: ' + problems.join('; ') + '. The site will deploy but show "Supabase is not configured". Fix in Netlify -> Site configuration -> Environment variables, then redeploy.');
} else {
  console.log('public/config.js written for ' + url);
}
process.exit(0);

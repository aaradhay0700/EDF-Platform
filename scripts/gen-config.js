// Netlify build step: writes public/config.js from environment variables.
// Only the public anon key belongs here - never the service_role key.
const fs = require('fs');
const path = require('path');
// Accepts SUPABASE_URL / SUPABASE_ANON_KEY, or the alternative names Project_URL / ANON_Public (case-insensitive).
const pick = (...names) => { for (const n of names) { const k = Object.keys(process.env).find((e) => e.toLowerCase() === n.toLowerCase()); if (k && process.env[k]) return process.env[k].trim(); } return ''; };
const url = pick('SUPABASE_URL', 'Project_URL');
const key = pick('SUPABASE_ANON_KEY', 'ANON_Public');
if (!url || !key) {
  console.error('ERROR: set SUPABASE_URL and SUPABASE_ANON_KEY in Netlify (Site configuration -> Environment variables).');
  process.exit(1);
}
fs.writeFileSync(path.join(__dirname, '..', 'public', 'config.js'),
  `window.EDF_CONFIG = ${JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key })};\n`);
console.log('public/config.js written');

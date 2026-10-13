// Netlify build step: writes public/config.js from environment variables.
// Only the public anon key belongs here - never the service_role key.
const fs = require('fs');
const path = require('path');
const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_ANON_KEY || '';
if (!url || !key) {
  console.error('ERROR: set SUPABASE_URL and SUPABASE_ANON_KEY in Netlify (Site configuration -> Environment variables).');
  process.exit(1);
}
fs.writeFileSync(path.join(__dirname, '..', 'public', 'config.js'),
  `window.EDF_CONFIG = ${JSON.stringify({ SUPABASE_URL: url, SUPABASE_ANON_KEY: key })};\n`);
console.log('public/config.js written');

// Publisher-only helper. Never include a private signing key in the app or repository.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const [installer,url,version,output]=process.argv.slice(2);
if(!installer||!url||!version||!output||!process.env.FLOW_UPDATE_SIGNING_KEY_FILE)throw Error('Usage: FLOW_UPDATE_SIGNING_KEY_FILE=<private-key-path> node desktop/scripts/sign-release.mjs <signed-installer.exe> <https-url> <version> <manifest.json>');
const location=new URL(url);if(location.protocol!=='https:'||location.username||location.password||!location.pathname.toLowerCase().endsWith('.exe')||!/^\d+\.\d+\.\d+$/.test(version))throw Error('Use an HTTPS installer URL and a semantic release version.');
const key=crypto.createPrivateKey(await fs.readFile(process.env.FLOW_UPDATE_SIGNING_KEY_FILE));if(key.asymmetricKeyType!=='ed25519')throw Error('An Ed25519 signing key is required.');
const bytes=await fs.readFile(installer),payload=JSON.stringify({product:'com.flowworkspace.desktop',platform:'win32-x64',version,url:location.href,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),expiresAt:new Date(Date.now()+14*86400000).toISOString(),notes:process.env.FLOW_RELEASE_NOTES||''});
await fs.writeFile(output,JSON.stringify({payload,signature:crypto.sign(null,Buffer.from(payload),key).toString('base64')},null,2)+'\n');
process.stdout.write('Signed release manifest written. Keep the signing key private.\n');

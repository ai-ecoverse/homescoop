import { createPrivateKey } from 'node:crypto';
import { entraAndArm, fresh, ok, served, SUBSCRIPTION } from './lib/az.mjs';

// The ssh-rsa public key's e and n (RFC 4253: string "ssh-rsa", mpint e,
// mpint n), base64url without leading zeros, as a JWK has them.
function sshRsa(line) {
  const [type, b64] = line.trim().split(/\s+/);
  const buf = Buffer.from(b64, 'base64');
  const parts = [];
  for (let i = 0; i < buf.length;) {
    const n = buf.readUInt32BE(i);
    parts.push(buf.subarray(i + 4, i + 4 + n));
    i += 4 + n;
  }
  const strip = (b) => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; return b.subarray(i); };
  return { type, name: parts[0].toString(), e: strip(parts[1]).toString('base64url'), n: strip(parts[2]).toString('base64url') };
}

// --generate-ssh-keys, as az aks create (azure-cli-core's keys.py, on
// cryptography) and az lab vm create (paramiko's RSAKey, on cryptography,
// with bcrypt and PyNaCl imported) make the key pair: the private key is a
// PEM RSA key with mode 0600 in a 0700 directory, the public key an OpenSSH
// ssh-rsa line, and the two are one key, checked in Node (the private key's
// modulus and exponent are the public line's). The create request the
// stand-in gets carries that public key.
export default async function (ctx) {
  const { assert } = ctx;
  await ctx.serve(entraAndArm);
  const cfg = fresh('sshkeys');
  await ok(ctx, `${cfg} az login --service-principal -u cafe0000-0000-4000-8000-00000000a99a -p cert-secret --tenant 72f988bf-0000-4000-8000-00000000c0de -o none`);
  await ok(ctx, 'rm -rf /root/.ssh-aks /root/.ssh-lab');

  const check = async (dir, what) => {
    const modes = (await ok(ctx, `stat -c '%n %a' ${dir} ${dir}/id_rsa ${dir}/id_rsa.pub`)).stdout.trim().split('\n');
    assert.deepEqual(modes, [`${dir} 700`, `${dir}/id_rsa 600`, `${dir}/id_rsa.pub 644`], `${what}: ${modes}`);
    const priv = await ctx.read(`${dir}/id_rsa`);
    const pub = (await ctx.read(`${dir}/id_rsa.pub`)).trim();
    assert.match(priv, /^-----BEGIN RSA PRIVATE KEY-----\n[\s\S]+\n-----END RSA PRIVATE KEY-----\n?$/, `${what}: ${priv.slice(0, 40)}`);
    const key = createPrivateKey(priv);
    assert.equal(key.asymmetricKeyType, 'rsa');
    assert.equal(key.asymmetricKeyDetails.modulusLength, 2048);
    const jwk = key.export({ format: 'jwk' });
    const line = sshRsa(pub);
    assert.deepEqual([line.type, line.name, line.e, line.n], ['ssh-rsa', 'ssh-rsa', jwk.e, jwk.n], `${what}: the public key isn't the private key's`);
    return pub;
  };

  // az aks create: the PUT of the managed cluster.
  const aks = await ok(ctx, `${cfg} az aks create -g cert-rg -n certaks --location westeurope --generate-ssh-keys --ssh-key-value /root/.ssh-aks/id_rsa.pub --no-wait`);
  assert.match(aks.stderr, /SSH key files '\/root\/\.ssh-aks\/id_rsa' and '\/root\/\.ssh-aks\/id_rsa\.pub' have been generated/, aks.stderr);
  const aksPub = await check('/root/.ssh-aks', 'az aks create');
  const put = (await served(ctx)).filter((r) => r.method === 'PUT' && r.url.startsWith(`https://management.azure.com/subscriptions/${SUBSCRIPTION}/resourceGroups/cert-rg/providers/Microsoft.ContainerService/managedClusters/certaks?`)).pop();
  assert.ok(put, 'no PUT of the managed cluster');
  assert.deepEqual(JSON.parse(put.body).properties.linuxProfile.ssh.publicKeys, [{ keyData: aksPub }], put.body.slice(0, 2000));

  // az lab vm create: paramiko writes the key.
  const lab = await ok(ctx, `${cfg} az lab vm create -g cert-rg --lab-name certlab -n certvm --image "Ubuntu Server 22.04 LTS" --image-type gallery --size Standard_DS1 --authentication-type ssh --generate-ssh-keys --ssh-key /root/.ssh-lab/id_rsa.pub --admin-username certuser`);
  assert.match(lab.stderr, /Created SSH key files: \/root\/\.ssh-lab\/id_rsa,\/root\/\.ssh-lab\/id_rsa\.pub/, lab.stderr);
  assert.doesNotMatch(lab.stderr, /ERROR|Traceback/, lab.stderr);
  const labPub = await check('/root/.ssh-lab', 'az lab vm create');
  const env = (await served(ctx)).filter((r) => r.method === 'POST' && /\/labs\/certlab\/createEnvironment\?/i.test(r.url)).pop();
  assert.ok(env, 'no createEnvironment request');
  const props = JSON.parse(env.body).properties;
  assert.equal(props.sshKey, labPub, env.body);
  assert.equal(props.isAuthenticationWithSshKey, true);
  assert.notEqual(labPub, aksPub);
  console.log('--generate-ssh-keys: az aks create (cryptography) and az lab vm create (paramiko) write a 2048-bit PEM RSA key, 0600 in a 0700 directory, and its OpenSSH ssh-rsa public key (the same key, checked in Node); the managed cluster PUT and the lab createEnvironment carry it');
}

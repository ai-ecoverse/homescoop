"""Signs aws-c-auth's SigV4a test suite with botocore/sigv4a.py (cert/sigv4a.mjs).

python3 -S sigv4a_suite.py <bin/aws> <sigv4a-suite.json> prints, per test,
the key derived from the test's credentials, and for the header and the query
(presigned URL) variants: the canonical request, the string to sign and the
request as signed. Node compares them with the suite and verifies the
signatures (ECDSA is randomized, so a signature is checked, not compared).

The suite's configs map to botocore's signers: "normalize": true is
SigV4AsymAuth (path normalized, double-encoded) and SigV4AsymQueryAuth;
"sign_body": true signs X-Amz-Content-SHA256 (as S3SigV4AsymAuth always
does). Tests that need a config botocore has no signer for are skipped, with
the reason (SKIP below).
"""
import datetime
import hashlib
import json
import runpy
import sys
from urllib.parse import quote

# sys.path as bin/aws sets it up (lib/aws-cli, py-cryptography, py-cffi).
runpy.run_path(sys.argv[1], run_name='sigv4a_suite')['setup']('aws')
import botocore.auth  # noqa: E402
import botocore.sigv4a as v4a  # noqa: E402
from botocore.awsrequest import AWSRequest  # noqa: E402
from botocore.compat import HTTPHeaders  # noqa: E402
from botocore.credentials import Credentials  # noqa: E402

SKIP = {
    # Unnormalized paths, double-encoded: botocore's signers either normalize
    # and double-encode (SigV4) or do neither (S3).
    **{
        n: 'botocore has no signer that double-encodes an unnormalized path'
        for n in (
            'get-relative-relative-unnormalized',
            'get-relative-unnormalized',
            'get-slash-dot-slash-unnormalized',
            'get-slash-pointless-dot-unnormalized',
            'get-slash-unnormalized',
            'get-slashes-unnormalized',
            'get-space-unnormalized',
        )
    },
    'post-sts-header-after': 'botocore always signs the session token (omit_session_token)',
    'get-vanilla-query-order-key': 'the suite has no expected results for it',
    'get-vanilla-query-order-value': 'the suite has no expected results for it',
}
# Header-only: a presigned URL in botocore moves a form body into the query,
# and keeps one value per query key.
QUERY_SKIP = {
    'post-x-www-form-urlencoded': 'botocore presigning moves the form body into the query',
    'post-x-www-form-urlencoded-parameters': 'botocore presigning moves the form body into the query',
    'get-vanilla-query-order-key-case': 'botocore presigning keeps one value per query key',
}


def parse_request(text):
    head, _, body = text.partition('\n\n')
    lines = head.split('\n')
    method, rest = lines[0].split(' ', 1)
    # The path as the suite has it (botocore's SigV4 signer encodes the path
    # itself), the query percent-encoded (botocore signs it as it is).
    path, sep, query = rest.rsplit(' ', 1)[0].partition('?')
    target = path + sep + ''.join(ch if 32 < ord(ch) < 127 else quote(ch) for ch in query)
    headers = []
    for line in lines[1:]:
        if not line:
            continue
        if line[:1] in (' ', '\t') and headers:
            headers[-1][1] += '\n' + line  # a folded (multiline) value
        else:
            name, _, value = line.partition(':')
            headers.append([name, value])
    return method, target, headers, body.encode()


class FixedTime(datetime.datetime):
    now_value = None

    @classmethod
    def utcnow(cls):
        return cls.now_value


def sign(cls, test, query):
    ctx = test['context']
    c = ctx['credentials']
    creds = Credentials(c['access_key_id'], c['secret_access_key'], c.get('token'))
    method, target, headers, body = parse_request(test['request'])
    req = AWSRequest(method=method, url='https://example.amazonaws.com' + target, data=body or None)
    req.headers = HTTPHeaders.from_pairs(headers)
    if ctx.get('sign_body') and not query:
        req.headers['X-Amz-Content-SHA256'] = hashlib.sha256(body).hexdigest()
    signer = cls(creds, ctx['service'], ctx['region'])
    if query:
        signer._expires = ctx['expiration_in_seconds']
    seen = {}
    canonical, string_to_sign = signer.canonical_request, signer.string_to_sign
    signer.canonical_request = lambda r: seen.setdefault('canonical', canonical(r))
    signer.string_to_sign = lambda r, cr: seen.setdefault('sts', string_to_sign(r, cr))
    signer.add_auth(req)
    return {
        'canonical': seen['canonical'],
        'stringToSign': seen['sts'],
        'url': req.url,
        'headers': [[k, v] for k, v in req.headers.items()],
    }


def main():
    suite = json.load(open(sys.argv[2]))['tests']
    stamp = datetime.datetime.strptime('2015-08-30T12:36:00Z', '%Y-%m-%dT%H:%M:%SZ')
    FixedTime.now_value = stamp
    botocore.auth.datetime.datetime = FixedTime
    out = {}
    for name, test in sorted(suite.items()):
        if name in SKIP:
            out[name] = {'skip': SKIP[name]}
            continue
        assert test['context']['timestamp'] == '2015-08-30T12:36:00Z', name
        c = test['context']['credentials']
        key = v4a.derive_key(c['access_key_id'], c['secret_access_key'])
        n = key.public_key().public_numbers()
        res = {'publicKey': {'X': f'{n.x:064x}', 'Y': f'{n.y:064x}'}}
        res['header'] = sign(v4a.SigV4AsymAuth, test, False)
        if name in QUERY_SKIP:
            res['querySkip'] = QUERY_SKIP[name]
        else:
            res['query'] = sign(v4a.SigV4AsymQueryAuth, test, True)
        out[name] = res
    json.dump(out, sys.stdout)


main()

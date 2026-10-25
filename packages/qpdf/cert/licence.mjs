import { licenceFilesSpec } from '../../../scripts/browser-cert/licence-files.mjs';

const sphlibPermission = 'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.';

export default licenceFilesSpec({
  LICENSE: ['Apache License', 'Version 2.0, January 2004'],
  'NOTICE.md': [
    'qpdf is copyright (c) 2005-2021 Jay Berkenbilt',
    'The embedded sha2 code comes from sphlib 3.0',
    'Copyright (c) 2007-2011 Projet RNRT SAPHIR',
    sphlibPermission,
    "Philip J. Erdelsky's public domain implementation",
  ],
  'THIRD-PARTY-NOTICES.md': [
    'sphlib 3.0 SHA-2',
    'Copyright (c) 2007-2010 Projet RNRT SAPHIR',
    sphlibPermission,
    'Copyright (C) 1991-2, RSA Data Security, Inc. Created 1991.',
    'These notices must be retained in any copies of any part of this documentation and/or software.',
  ],
});

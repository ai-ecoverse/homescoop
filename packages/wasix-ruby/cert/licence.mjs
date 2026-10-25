import { licenceFilesSpec } from '../../../scripts/browser-cert/licence-files.mjs';

const mit = 'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.';
const bsdBinary = 'Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.';
const legal = [
  '[regparse.c]',
  'K.Kosako',
  '[missing/dtoa.c]',
  'Copyright (c) 1991, 2000, 2001:: by Lucent Technologies.',
  '[missing/mt19937.c]',
  'Coded by Takuji Nishimura and Makoto Matsumoto.',
  '[st.c]',
  '[ext/digest/sha2/sha2.c]',
  'Aaron D. Gifford',
  '[ext/digest/md5/md5.c]',
  '[vsnprintf.c]',
  '[missing/setproctitle.c]',
  '[coroutine]',
  '[ccan/list/list.h]',
  '[lib/rubygems.rb]',
  '== MIT License',
  mit,
  '== Old-style BSD license',
  bsdBinary,
];

export default licenceFilesSpec({
  LICENSE: [
    '==> COPYING <==',
    'Ruby is copyrighted free software by Yukihiro Matsumoto',
    '2-clause BSDL (see the file BSDL), or the conditions below:',
    '==> BSDL <==',
    'Copyright (C) 1993-2013 Yukihiro Matsumoto. All rights reserved.',
    bsdBinary,
  ],
  LEGAL: ['LEGAL NOTICE INFORMATION', ...legal],
  'THIRD-PARTY-NOTICES.md': ['## Ruby 3.4.11 bundled third-party code (upstream LEGAL)', 'LEGAL NOTICE INFORMATION', ...legal, '## OpenSSL 3.5.9', '## libyaml 0.2.5, MIT'],
});

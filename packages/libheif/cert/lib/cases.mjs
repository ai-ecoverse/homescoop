export const PNG_CASES = [
  { id: 'iphone13', args: ['iphone_13_pro_max.heic', 'iphone13.png'], outputs: ['iphone13.png'] },
  {
    id: 'pug-aux',
    args: ['--with-aux', '--no-colons', 'pug.heic', 'pug.png'],
    outputs: ['pug.png', 'pug-depth.png', 'pug-urn_com_apple_photo_2020_aux_hdrgainmap.png'],
  },
  { id: 'example', args: ['example.heic', 'example.png'], outputs: ['example-1.png', 'example-2.png'] },
  { id: 'avif', args: ['example.avif', 'avif.png'], outputs: ['avif.png'] },
  { id: 'rainbow', args: ['rainbow-451x461.heic', 'rainbow.png'], outputs: ['rainbow.png'] },
  { id: 'one', args: ['1x1.heic', 'one.png'], outputs: ['one.png'] },
  { id: 'odd', args: ['odd-1023x769.heic', 'odd.png'], outputs: ['odd.png'] },
  { id: 'rot90', args: ['rot90-17x9.heic', 'rot90.png'], outputs: ['rot90.png'] },
];

export const INFO_CASES = ['iphone_13_pro_max.heic', 'pug.heic', 'example.heic', 'example.avif', 'rot90-17x9.heic'];

export const TOLERANCE = { maxDelta: { 8: 1, 16: 1 }, maxFixedFraction: 0.0001 };

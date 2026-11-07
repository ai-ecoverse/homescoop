import { checkCases, linkZoneinfo } from './lib/zones.mjs';

// Ruby's Time#localtime is libc's localtime_r (musl's __tz.c).
const SCRIPT = String.raw`
ARGV.each do |arg|
  k, t = arg.split("=")
  puts "#{k} #{Time.at(Integer(t)).strftime("%H:%M %Z %z")}"
end
`;

export default async function (ctx) {
  await linkZoneinfo(ctx);
  await ctx.write('/tmp/tz_local.rb', SCRIPT);
  await checkCases(ctx, 'ruby', ['ruby', '/tmp/tz_local.rb']);
}

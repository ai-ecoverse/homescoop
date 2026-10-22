#define _GNU_SOURCE
#include <emscripten.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

void _localtime_js(time_t t, struct tm *tm);
void _tzset_js(long *timezone, int *daylight, char *std_name, char *dst_name);
time_t _mktime_js(struct tm *tm);
void _gmtime_js(time_t t, struct tm *tm);

EM_JS(int, slicc_tz_intl, (const char *name, double t, char *abbr, int abbrlen), {
  try {
    const zone = UTF8ToString(name);
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", timeZoneName: "short" });
    const at = (s) => {
      const parts = {};
      for (const p of fmt.formatToParts(new Date(s * 1000))) parts[p.type] = p.value;
      const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) / 1000;
      return { off: Math.round(wall - s), name: parts.timeZoneName };
    };
    const now = at(t);
    if (!Module.sliccTzTable) {
      const groups = [
        ["Europe/London Europe/Belfast Europe/Guernsey Europe/Isle_of_Man Europe/Jersey GB GB-Eire", { 0: "GMT", "d3600": "BST" }],
        ["Europe/Dublin Eire", { 0: "GMT", "d3600": "IST" }],
        ["Europe/Lisbon Portugal Atlantic/Madeira Atlantic/Canary Atlantic/Faroe Atlantic/Faeroe WET", { 0: "WET", "d3600": "WEST" }],
        ["Europe/Amsterdam Europe/Andorra Europe/Belgrade Europe/Berlin Europe/Bratislava Europe/Brussels Europe/Budapest Europe/Busingen Europe/Copenhagen Europe/Gibraltar Europe/Ljubljana Europe/Luxembourg Europe/Madrid Europe/Malta Europe/Monaco Europe/Oslo Europe/Paris Europe/Podgorica Europe/Prague Europe/Rome Europe/San_Marino Europe/Sarajevo Europe/Skopje Europe/Stockholm Europe/Tirane Europe/Vaduz Europe/Vatican Europe/Vienna Europe/Warsaw Europe/Zagreb Europe/Zurich Africa/Ceuta Africa/Algiers Africa/Tunis Arctic/Longyearbyen Atlantic/Jan_Mayen Poland CET MET", { 3600: "CET", "d7200": "CEST" }],
        ["Europe/Athens Europe/Bucharest Europe/Chisinau Europe/Helsinki Europe/Kiev Europe/Kyiv Europe/Mariehamn Europe/Riga Europe/Sofia Europe/Tallinn Europe/Tiraspol Europe/Uzhgorod Europe/Vilnius Europe/Zaporozhye Europe/Nicosia Europe/Kaliningrad Asia/Beirut Asia/Nicosia Africa/Cairo Egypt EET", { 7200: "EET", "d10800": "EEST" }],
        ["Europe/Moscow Europe/Simferopol Europe/Kirov Europe/Volgograd W-SU", { 10800: "MSK" }],
        ["Asia/Jerusalem Asia/Tel_Aviv Israel", { 7200: "IST", "d10800": "IDT" }],
        ["Asia/Kolkata Asia/Calcutta", { 19800: "IST" }],
        ["Asia/Karachi", { 18000: "PKT", "d21600": "PKST", since: 31536000 }],
        ["Asia/Tokyo Japan", { 32400: "JST", "d36000": "JDT" }],
        ["Asia/Seoul Asia/Pyongyang ROK", { 32400: "KST", "d36000": "KDT" }],
        ["Asia/Shanghai Asia/Chongqing Asia/Chungking Asia/Harbin Asia/Taipei Asia/Macau Asia/Macao PRC ROC", { 28800: "CST", "d32400": "CDT" }],
        ["Asia/Manila", { 28800: "PST", "d32400": "PDT" }],
        ["Asia/Hong_Kong Hongkong", { 28800: "HKT", "d32400": "HKST" }],
        ["Asia/Jakarta Asia/Pontianak", { 25200: "WIB" }],
        ["Asia/Makassar Asia/Ujung_Pandang", { 28800: "WITA" }],
        ["Asia/Jayapura", { 32400: "WIT" }],
        ["Australia/Sydney Australia/Melbourne Australia/Hobart Australia/Canberra Australia/ACT Australia/NSW Australia/Victoria Australia/Tasmania Australia/Currie Australia/Brisbane Australia/Lindeman Australia/Queensland Antarctica/Macquarie", { 36000: "AEST", "d39600": "AEDT" }],
        ["Australia/Adelaide Australia/Broken_Hill Australia/South Australia/Yancowinna Australia/Darwin Australia/North", { 34200: "ACST", "d37800": "ACDT" }],
        ["Australia/Perth Australia/West", { 28800: "AWST", "d32400": "AWDT" }],
        ["Pacific/Auckland Antarctica/McMurdo Antarctica/South_Pole NZ", { 43200: "NZST", "d46800": "NZDT" }],
        ["Pacific/Guam Pacific/Saipan", { 36000: "ChST", since: 977493600 }],
        ["Africa/Windhoek", { 7200: "CAT", since: 637365600 }],
        ["Asia/Gaza Asia/Hebron", { 7200: "EET", "d10800": "EEST", since: 820454400 }],
        ["Pacific/Pago_Pago Pacific/Midway Pacific/Samoa US/Samoa", { [-39600]: "SST" }],
        ["America/Adak America/Atka US/Aleutian", { [-36000]: "HST", "d-32400": "HDT" }],
        ["America/Hermosillo America/Mazatlan America/Chihuahua America/Ciudad_Juarez America/Ojinaga America/Dawson America/Whitehorse Mexico/BajaSur Canada/Yukon", { [-25200]: "MST", "d-21600": "MDT", intl: 1 }],
        ["America/Havana Cuba", { [-18000]: "CST", "d-14400": "CDT" }],
        ["Etc/GMT Etc/GMT0 Etc/GMT+0 Etc/GMT-0 Etc/Greenwich GMT GMT0 GMT+0 GMT-0 Greenwich", { 0: "GMT" }],
        ["Antarctica/Troll", { 0: "+00", "d7200": "+02" }],
        ["America/St_Johns Canada/Newfoundland", { [-12600]: "NST", "d-9000": "NDT" }],
        ["Africa/Johannesburg Africa/Maseru Africa/Mbabane", { 7200: "SAST" }],
        ["Africa/Maputo Africa/Blantyre Africa/Bujumbura Africa/Gaborone Africa/Harare Africa/Kigali Africa/Lubumbashi Africa/Lusaka", { 7200: "CAT" }],
        ["Africa/Juba Africa/Khartoum", { 7200: "CAT", 10800: "EAT" }],
        ["Africa/Nairobi Africa/Addis_Ababa Africa/Asmara Africa/Asmera Africa/Dar_es_Salaam Africa/Djibouti Africa/Kampala Africa/Mogadishu Indian/Antananarivo Indian/Comoro Indian/Mayotte", { 10800: "EAT" }],
        ["Africa/Lagos Africa/Bangui Africa/Brazzaville Africa/Douala Africa/Kinshasa Africa/Libreville Africa/Luanda Africa/Malabo Africa/Niamey Africa/Porto-Novo Africa/Ndjamena", { 3600: "WAT" }],
      ];
      const table = {};
      for (const [zones, names] of groups) for (const z of zones.split(" ")) table[z] = names;
      Module.sliccTzTable = table;
    }
    const canon = fmt.resolvedOptions().timeZone;
    const names = Module.sliccTzTable[zone] || Module.sliccTzTable[canon];
    const memo = (Module.sliccTzLow ||= new Map());
    const key = zone + "|" + Math.floor(t / 86400);
    let low = memo.get(key);
    if (!low) {
      low = [Infinity, Infinity];
      for (let m = 1; m <= 12; m++) {
        low[0] = Math.min(low[0], at(t - m * 2629800).off);
        low[1] = Math.min(low[1], at(t + m * 2629800).off);
      }
      if (memo.size > 4096) memo.clear();
      memo.set(key, low);
    }
    const dst = now.off > low[0] && now.off > low[1] ? 1 : 0;
    const fixed = names && !(t < names.since) && names[(dst ? "d" : "") + now.off];
    let label = fixed && !names.intl ? fixed : /^[A-Za-z]{3,5}$/.test(now.name) ? now.name : fixed;
    if (!label) {
      const a = Math.abs(now.off);
      const hh = String(Math.floor(a / 3600)).padStart(2, "0");
      const mm = Math.floor(a / 60) % 60;
      label = (now.off < 0 ? "-" : "+") + hh + (mm ? String(mm).padStart(2, "0") : "");
    }
    if (abbr) stringToUTF8(label, abbr, abbrlen);
    return now.off * 2 + dst;
  } catch (e) {
    return 0x7fffffff;
  }
});

struct rule {
  int kind;
  int a, b, c;
  long time;
};

struct zone {
  int kind;
  long std_gmt, dst_gmt;
  int has_dst;
  struct rule start, end;
  char std[32], dst[32], iana[96];
};

static char key[160];
static int have_key;
static struct zone cur;
static char host_std[17], host_dst[17];
static char abbr_buf[32];
static char names[16][32];
static int nnames;

static const char *intern(const char *s) {
  for (int i = 0; i < nnames; i++)
    if (!strcmp(names[i], s)) return names[i];
  int i = nnames < 16 ? nnames++ : 15;
  strncpy(names[i], s, sizeof names[i] - 1);
  names[i][sizeof names[i] - 1] = 0;
  return names[i];
}

static int digit(char c) { return c >= '0' && c <= '9'; }

static const char *name_of(const char *p, char *out, size_t n) {
  size_t i = 0;
  if (*p == '<') {
    p++;
    while (*p && *p != '>') {
      if (i + 1 < n) out[i++] = *p;
      p++;
    }
    if (*p != '>') return NULL;
    p++;
  } else {
    while ((*p >= 'A' && *p <= 'Z') || (*p >= 'a' && *p <= 'z')) {
      if (i + 1 < n) out[i++] = *p;
      p++;
    }
  }
  out[i] = 0;
  return i >= 3 ? p : NULL;
}

static const char *hms(const char *p, long *out) {
  int neg = 0;
  if (*p == '+' || *p == '-') neg = *p++ == '-';
  if (!digit(*p)) return NULL;
  long h = 0, m = 0, s = 0;
  while (digit(*p)) h = h * 10 + (*p++ - '0');
  if (*p == ':') {
    p++;
    while (digit(*p)) m = m * 10 + (*p++ - '0');
    if (*p == ':') {
      p++;
      while (digit(*p)) s = s * 10 + (*p++ - '0');
    }
  }
  *out = (neg ? -1 : 1) * (h * 3600 + m * 60 + s);
  return p;
}

static const char *rule_of(const char *p, struct rule *r) {
  if (*p == 'M') {
    p++;
    r->kind = 'M';
    r->a = r->b = r->c = 0;
    while (digit(*p)) r->a = r->a * 10 + (*p++ - '0');
    if (*p++ != '.') return NULL;
    while (digit(*p)) r->b = r->b * 10 + (*p++ - '0');
    if (*p++ != '.') return NULL;
    while (digit(*p)) r->c = r->c * 10 + (*p++ - '0');
    if (r->a < 1 || r->a > 12 || r->b < 1 || r->b > 5 || r->c > 6) return NULL;
  } else {
    r->kind = *p == 'J' ? 'J' : 'N';
    if (*p == 'J') p++;
    if (!digit(*p)) return NULL;
    r->a = 0;
    while (digit(*p)) r->a = r->a * 10 + (*p++ - '0');
  }
  r->time = 7200;
  if (*p == '/') {
    p = hms(p + 1, &r->time);
    if (!p) return NULL;
  }
  return p;
}

static int posix(const char *p, struct zone *z) {
  long off;
  memset(z, 0, sizeof *z);
  z->kind = 1;
  if (!(p = name_of(p, z->std, sizeof z->std))) return 0;
  if (!(p = hms(p, &off))) return 0;
  z->std_gmt = -off;
  if (!*p) return 1;
  if (!(p = name_of(p, z->dst, sizeof z->dst))) return 0;
  z->has_dst = 1;
  z->dst_gmt = z->std_gmt + 3600;
  if (*p && *p != ',') {
    if (!(p = hms(p, &off))) return 0;
    z->dst_gmt = -off;
  }
  if (!*p) p = ",M3.2.0,M11.1.0";
  if (*p++ != ',' || !(p = rule_of(p, &z->start)) || *p++ != ',' || !(p = rule_of(p, &z->end))) return 0;
  return *p == 0;
}

static long long days_from_civil(long long y, int m, int d) {
  y -= m <= 2;
  long long era = (y >= 0 ? y : y - 399) / 400;
  long long yoe = y - era * 400;
  long long doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  long long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + doe - 719468;
}

static int leap(long long y) { return (y % 4 == 0 && y % 100 != 0) || y % 400 == 0; }

static long long rule_secs(const struct rule *r, long long y) {
  static const int mdays[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  long long day;
  if (r->kind == 'J') {
    int n = r->a;
    day = days_from_civil(y, 1, 1) + n - 1 + (leap(y) && n >= 60);
  } else if (r->kind == 'N') {
    day = days_from_civil(y, 1, 1) + r->a;
  } else {
    long long first = days_from_civil(y, r->a, 1);
    int wday = (int)(((first % 7) + 11) % 7);
    int d = (r->c - wday + 7) % 7 + 1 + 7 * (r->b - 1);
    int len = mdays[r->a - 1] + (r->a == 2 && leap(y));
    while (d > len) d -= 7;
    day = first + d - 1;
  }
  return day * 86400 + r->time;
}

static int in_dst(const struct zone *z, long long t) {
  if (!z->has_dst) return 0;
  long long y = 1970 + (t + z->std_gmt) / 31556952;
  for (int k = 0; k < 2; k++) {
    if (days_from_civil(y, 1, 1) * 86400 > t + z->std_gmt) y--;
    else if (days_from_civil(y + 1, 1, 1) * 86400 <= t + z->std_gmt) y++;
  }
  long long t0 = rule_secs(&z->start, y) - z->std_gmt;
  long long t1 = rule_secs(&z->end, y) - z->dst_gmt;
  return t0 < t1 ? t >= t0 && t < t1 : !(t >= t1 && t < t0);
}

static void load(void) {
  const char *tz = getenv("TZ");
  char want[sizeof key];
  if (!tz) strcpy(want, "\001host");
  else {
    strncpy(want, tz, sizeof want - 1);
    want[sizeof want - 1] = 0;
  }
  if (have_key && !strcmp(want, key)) return;
  strcpy(key, want);
  have_key = 1;
  memset(&cur, 0, sizeof cur);
  if (!tz) {
    cur.kind = 0;
    long tzv;
    int dl;
    _tzset_js(&tzv, &dl, host_std, host_dst);
    return;
  }
  if (!*tz) {
    cur.kind = 1;
    strcpy(cur.std, "UTC");
    return;
  }
  const char *name = *tz == ':' ? tz + 1 : tz;
  if (*tz != ':' && posix(tz, &cur)) return;
  memset(&cur, 0, sizeof cur);
  strncpy(cur.iana, name, sizeof cur.iana - 1);
  if (slicc_tz_intl(cur.iana, 0, NULL, 0) != 0x7fffffff) {
    cur.kind = 2;
    return;
  }
  cur.kind = 1;
  strcpy(cur.std, "UTC");
}

static void zone_at(long long t, long *gmt, int *dst, const char **name) {
  if (cur.kind == 1) {
    *dst = in_dst(&cur, t);
    *gmt = *dst ? cur.dst_gmt : cur.std_gmt;
    *name = *dst ? cur.dst : cur.std;
    return;
  }
  int v = slicc_tz_intl(cur.iana, (double)t, abbr_buf, sizeof abbr_buf);
  *dst = v & 1;
  *gmt = v >> 1;
  *name = intern(abbr_buf);
}

void tzset(void) {
  load();
  if (cur.kind == 0) {
    _tzset_js(&timezone, &daylight, host_std, host_dst);
    tzname[0] = host_std;
    tzname[1] = host_dst;
    return;
  }
  if (cur.kind == 1) {
    timezone = -cur.std_gmt;
    daylight = cur.has_dst;
    tzname[0] = cur.std;
    tzname[1] = cur.has_dst ? cur.dst : cur.std;
    return;
  }
  time_t now = time(NULL);
  long gmt;
  int dst;
  const char *name;
  zone_at(now, &gmt, &dst, &name);
  timezone = -gmt;
  daylight = dst;
  tzname[0] = tzname[1] = (char *)name;
}

struct tm *__localtime_r(const time_t *restrict t, struct tm *restrict tm) {
  tzset();
  if (cur.kind == 0) {
    _localtime_js(*t, tm);
    tm->__tm_zone = tm->tm_isdst ? host_dst : host_std;
    return tm;
  }
  long gmt;
  int dst;
  const char *name;
  zone_at(*t, &gmt, &dst, &name);
  time_t local = *t + gmt;
  _gmtime_js(local, tm);
  tm->tm_isdst = dst;
  tm->__tm_gmtoff = gmt;
  tm->__tm_zone = name;
  return tm;
}

struct tm *localtime_r(const time_t *restrict t, struct tm *restrict tm) { return __localtime_r(t, tm); }

time_t mktime(struct tm *tm) {
  tzset();
  if (cur.kind == 0) return _mktime_js(tm);
  int want = tm->tm_isdst;
  struct tm u = *tm;
  time_t wall = timegm(&u);
  long gmt;
  int dst;
  const char *name;
  time_t t = wall - (cur.kind == 1 ? cur.std_gmt : 0);
  for (int k = 0; k < 3; k++) {
    zone_at(t, &gmt, &dst, &name);
    t = wall - gmt;
  }
  if (cur.kind == 1 && cur.has_dst && want >= 0 && want != dst) t = wall - (want ? cur.dst_gmt : cur.std_gmt);
  __localtime_r(&t, tm);
  return t;
}

const { createApp, reactive, ref, computed, onMounted, onUnmounted, watch, nextTick } = Vue;

// ---------- helpers ----------
// Web build (GitHub Pages): config.js sets the backend address; served by the backend itself it stays same-origin.
const API = (window.PERLIV_API || '').replace(/\/+$/, '');
const AUTH_KEY = 'perliv.token';
const auth = {
  get() {
    for (const s of [sessionStorage, localStorage]) {
      try { const t = JSON.parse(s.getItem(AUTH_KEY) || 'null'); if (t && t.exp * 1000 > Date.now()) return t.token; } catch (e) {}
    }
    return null;
  },
  set(token, exp, remember) {
    this.clear();
    try { (remember ? localStorage : sessionStorage).setItem(AUTH_KEY, JSON.stringify({ token, exp })); } catch (e) {}
  },
  clear() { for (const s of [sessionStorage, localStorage]) { try { s.removeItem(AUTH_KEY); } catch (e) {} } },
};
// for <img>/downloads that cannot send headers
const withToken = url => { const t = auth.get(); return API + url + (t ? (url.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(t) : ''); };
async function api(path, opts = {}) {
  const t = auth.get(), headers = opts.body ? { 'Content-Type': 'application/json' } : {};
  if (t) headers.Authorization = 'Bearer ' + t;
  const r = await fetch(API + path, {
    method: opts.method || 'GET', headers, credentials: 'omit',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (r.status === 401 && path !== '/api/login') { auth.clear(); store.login = true; }
  if (!r.ok) {
    let msg = r.statusText;
    try { const d = (await r.json()).detail; msg = typeof d === 'string' ? d : d ? 'Неверный запрос (' + r.status + ')' : msg; } catch (e) {}
    throw new Error(msg);
  }
  return r.json();
}
const fmt = n => n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
const signed = n => n == null ? '—' : (n > 0 ? '+' : '') + fmt(n);
const ago = ts => {
  if (!ts) return '—';
  const s = Date.now() / 1000 - ts;
  if (s < 0) return 'через ' + dur(-s);
  if (s < 90) return 'только что';
  return dur(s) + ' назад';
};
const dur = s => s < 3600 ? Math.round(s / 60) + ' мин' : s < 86400 ? Math.round(s / 3600) + ' ч' : Math.round(s / 86400) + ' д';
const dt = ts => ts ? new Date(ts * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const day = ts => ts ? new Date(ts * 1000).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
const dtFull = ts => ts ? new Date(ts * 1000).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const host = u => { try { return new URL(u).hostname.replace('www.', ''); } catch (e) { return u; } };
const igUrl = u => 'https://www.instagram.com/' + u + '/';
const postUrl = c => 'https://www.instagram.com/p/' + c + '/';
const ROLE = { focus: ['Фокус', 'c'], project: ['Проект', 'p'], candidate: ['Кандидат', ''], source: ['Источник', ''], rejected: ['Отклонён', 'r'] };
const KIND = { project: ['проект', 'p'], not_project: ['не проект', ''], unknown: ['не ясно', 'w'], filtered: ['вне фильтра', 'w'] };
const REGION = { us: 'US', non_us: 'не US' };

// ---------- design system: icons, theme, chart colours ----------
// Lucide icons from web/icons.js (local, no network); markup is a fixed whitelist of shapes built by the icon script.
const Icon = {
  props: { name: String, size: String, spin: Boolean, title: String },
  template: `<svg :class="['ic', size, {spin}]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"
    stroke-linejoin="round" :aria-hidden="title ? null : 'true'" :role="title ? 'img' : null" :aria-label="title" v-html="svg"></svg>`,
  computed: { svg() { return (window.ICONS || {})[this.name] || ''; } },
};
// Loading placeholder that keeps the layout stable (no flashing spinner).
const Skel = {
  props: { rows: { type: Number, default: 4 }, blocks: { type: Number, default: 0 } },
  template: `<div class="skel" aria-busy="true" aria-label="Загрузка">
    <div v-if="blocks" class="kpis" style="margin:0"><i v-for="i in blocks" :key="'b' + i" class="blk"></i></div>
    <i v-for="i in rows" :key="i" :style="{width: (60 + (i * 37) % 40) + '%'}"></i></div>`,
};
// Empty state: icon + what it means + what to do next.
const Empty = {
  props: { icon: { type: String, default: 'info' }, text: String },
  template: `<div class="empty"><Icon :name="icon" size="xl"/><div>{{ text }}</div><slot/></div>`,
};
const THEMES = [['light', 'sun', 'Светлая тема'], ['system', 'monitor', 'Как в системе'], ['dark', 'moon', 'Тёмная тема']];
function getTheme() { try { return localStorage.getItem('perliv.theme') || 'system'; } catch (e) { return 'system'; } }
function setTheme(t) {
  try { localStorage.setItem('perliv.theme', t); } catch (e) {}
  if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  store.theme = t;
  store.ver++;   // re-mount the page: charts and the graph read colours from the new tokens
}
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
// Chart.js axis/grid/legend colours from the current theme tokens
function chartTheme() {
  return { text: css('--muted'), dim: css('--dim'), grid: css('--line'), primary: css('--primary'), accent: css('--accent'),
    series: [css('--primary'), css('--accent'), css('--violet'), css('--info'), css('--good'), css('--bad'), css('--dim'), css('--heading')] };
}
const alpha = (hex, a) => {   // '#rrggbb' → rgba() for chart fills
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return hex;
  const n = parseInt(m[1], 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

// ver grows every time a run finishes: the open page is re-mounted and shows the new data without F5.
const store = reactive({ st: null, toast: null, route: { name: 'dash', arg: null }, ver: 0, theme: getTheme(), menu: false, login: false });
function toast(msg, err = false) {
  store.toast = { msg, err };
  clearTimeout(toast._t);
  toast._t = setTimeout(() => store.toast = null, 4500);
}
async function refreshState() {
  if (store.login) return;
  try {
    const was = store.st?.pipeline.running;
    store.st = await api('/api/state');
    if (was && !store.st.pipeline.running) { store.ver++; toast('Анализ завершён — данные обновлены'); }
  } catch (e) {}
}
async function runNow() {
  try { await api('/api/run', { method: 'POST' }); toast('Анализ запущен'); refreshState(); }
  catch (e) { toast(e.message, true); }
}
async function runBulk() {
  const s = store.st;
  const useOllama = confirm('Большой разбор очереди.\n\n1) ИИ отсортирует ВСЮ очередь кандидатов по подписям постов — без Instagram.\n' +
    '2) Откроются профили только самых перспективных (сколько — в Настройках, «Большой разбор: открыть профилей»).\n' +
    '3) Все открытые проверит ИИ, найденные проекты перепроверятся на язык и регион.\n\n' +
    'OK — локальная модель Ollama (' + (s?.llm.model || '') + ', без лимитов, пачками с паузами).\nОтмена — выбрать Gemini или не запускать.');
  let provider = 'ollama';
  if (!useOllama) {
    if (!confirm('Запустить большой разбор через Gemini (лимит 400 запросов в день)?')) return;
    provider = 'gemini';
  }
  try { await api('/api/run?kind=bulk&provider=' + provider, { method: 'POST' }); toast('Большой разбор запущен'); refreshState(); }
  catch (e) { toast(e.message, true); }
}
async function runApify() {
  if (!confirm('Быстрый проход через Apify: все фокус-паблики (профиль + 12 последних постов) и очередь кандидатов, ' +
    'без сессии Instagram. Стоимость около $2.6 за 1000 профилей, общий лимит — в Настройках («Apify: бюджет быстрого прохода»). ' +
    'Затем всё проверит ИИ (Ollama, пачками с паузами). Запустить?')) return;
  try { await api('/api/run?kind=apify', { method: 'POST' }); toast('Быстрый проход запущен'); refreshState(); }
  catch (e) { toast(e.message, true); }
}
const H = { fmt, signed, ago, dt, day, host, igUrl, postUrl, ROLE, KIND, REGION, store, runBulk, runApify };

// ---------- shared components ----------
const Av = {
  props: ['u', 'src', 'size'],
  template: `<img v-if="src && !broken" :src="withToken('/avatars/' + src)" :class="['av', size]" @error="broken=true" loading="lazy">
             <div v-else :class="['av', size]">{{ (u || '?')[0].toUpperCase() }}</div>`,
  data: () => ({ broken: false }),
  methods: { withToken },
};
const Who = {
  components: { Av },
  props: ['u', 'src', 'sub', 'size'],
  template: `<div class="who"><Av :u="u" :src="src" :size="size"/><div style="min-width:0">
      <div class="n"><a :href="'#/a/' + u">@{{ u }}</a><a :href="'https://www.instagram.com/' + u + '/'" target="_blank" rel="noopener" class="ext" :aria-label="'@' + u + ' в Instagram'" title="Открыть в Instagram"><Icon name="external-link" size="sm"/></a></div>
      <div class="s" v-if="sub">{{ sub }}</div></div></div>`,
};
const Spark = {
  props: ['v'],
  template: `<svg v-if="v && v.length > 1" class="spark" width="100%" height="34" viewBox="0 0 100 34" preserveAspectRatio="none">
      <polyline :points="pts" fill="none" stroke="var(--primary)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>
    <div v-else class="dim small" style="height:34px;display:flex;align-items:center">график появится после 2+ прогонов</div>`,
  computed: {
    pts() {
      const v = this.v, mn = Math.min(...v), mx = Math.max(...v), r = mx - mn || 1;
      return v.map((y, i) => (i / (v.length - 1) * 100).toFixed(1) + ',' + (32 - (y - mn) / r * 30).toFixed(1)).join(' ');
    },
  },
};
const Links = {
  props: ['links'],
  template: `<div class="row" style="gap:6px"><a v-for="l in (links||[]).slice(0,4)" :key="l" :href="l" target="_blank" rel="noopener" class="chip c" :title="l"><Icon name="link" size="sm"/>{{ host(l) }}</a></div>`,
  methods: { host },
};

const REASONS = { media: 'медиа / паблик', brand: 'бренд / компания', celebrity: 'знаменитость', no_funnel: 'нет воронки', wrong_niche: 'не та ниша', other: 'другое' };
const featTitle = f => f.replace(/^domain:/, 'сайт: ').replace(/^word:/, '“').replace(/^niche:/, 'ниша: ').replace(/^funnel:/, 'воронка: ')
  .replace(/^persona:face$/, 'с лицом').replace(/^persona:faceless$/, 'faceless').replace(/^size:/, 'аудитория ') + (f.startsWith('word:') ? '”' : '');

// 👍 / 👎 with dislike reasons. Every vote retrains the taste model and is shown to Gemini as an example.
const Vote = {
  props: ['u', 'vote', 'reason', 'via'],
  emits: ['voted'],
  template: `<span class="vote" @click.stop>
      <button :class="['vb', {on: v === 1}]" title="Это проект — искать похожие" aria-label="Это проект" :aria-pressed="v === 1" @click="send(v === 1 ? null : 1)"><Icon name="thumbs-up"/></button>
      <button :class="['vb', 'down', {on: v === -1}]" title="Не проект — меньше такого" aria-label="Не проект" :aria-pressed="v === -1" @click="v === -1 ? send(null) : (ask = !ask)"><Icon name="thumbs-down"/></button>
      <span v-if="ask" class="reasons"><button v-for="(t, k) in REASONS" :key="k" class="chip" @click="send(-1, k)">{{ t }}</button></span>
      <span v-else-if="v === -1 && r" class="dim small">{{ REASONS[r] || r }}</span></span>`,
  data() { return { v: this.vote, r: this.reason, ask: false, REASONS }; },
  watch: { vote(x) { this.v = x; }, reason(x) { this.r = x; } },
  methods: {
    async send(label, reason = null) {
      this.ask = false;
      await api('/api/feedback/' + this.u, { method: 'POST', body: { label, reason, via: this.via } });
      this.v = label; this.r = reason;
      toast(label === 1 ? 'Учту: это проект, ищу похожие' : label === -1 ? 'Учту: не проект, такого будет меньше' : 'Оценка снята');
      this.$emit('voted', label);
    },
  },
};
const Taste = {
  props: ['t'],
  template: `<span v-if="t && t.taste != null" :class="['chip', t.taste >= 70 ? 'g' : t.taste <= 30 ? 'r' : '']"
      :title="'Совпадение с твоими оценками. ' + (t.why.length ? 'Почему: ' + t.why.map(w => featTitle(w.f) + ' ' + (w.w > 0 ? '+' : '') + w.w).join(', ') : 'Мало общих признаков с оценёнными')"><Icon name="heart" size="sm"/>{{ t.taste }}%</span>`,
  methods: { featTitle },
};

// ---------- pages ----------
// First page: accounts that look like projects and were advertised in our focus publics, by niche.
const Home = {
  template: `
  <div>
    <div class="head"><h1>Кандидаты в проекты</h1><span class="sub">кого рекламировали наши фокус-паблики, по нишам</span><span class="sp"></span>
      <button class="btn" :disabled="st?.pipeline.running" @click="discover" title="Один прогон с поиском вне фокуса: разведка площадок, поиск по словам, идеи ниш"><Icon name="search"/>Искать новые проекты</button>
      <button class="btn primary" :disabled="st?.pipeline.running" @click="runNow"><Icon :name="st?.pipeline.running ? 'loader-circle' : 'play'" :spin="st?.pipeline.running"/>{{ st?.pipeline.running ? 'Идёт анализ…' : 'Проверить фокус' }}</button></div>
    <div class="card" v-if="st?.pipeline.running" style="margin-bottom:14px">
      <div class="row" style="margin-bottom:8px"><span class="pulse"></span><b>{{ st.pipeline.stage }}</b><span class="muted" v-if="st.pipeline.total">{{ st.pipeline.done }} / {{ st.pipeline.total }}</span></div>
      <div class="progress"><div :style="{width: (st.pipeline.total ? st.pipeline.done / st.pipeline.total * 100 : 5) + '%'}"></div></div></div>

    <div class="row" style="gap:10px;margin-bottom:14px">
      <input v-model="q" placeholder="Поиск: ник, био, ниша" aria-label="Поиск" style="width:220px">
      <div class="seg" role="group" aria-label="Подписчики">
        <button v-for="o in SIZES" :key="o[0]" :class="['btn sm', size === o[0] ? 'primary' : '']" @click="size = o[0]" :aria-pressed="size === o[0]">{{ o[1] }}</button></div>
      <label class="small row" style="gap:6px"><input type="checkbox" v-model="showTracked"> показывать уже отслеживаемые</label>
      <span class="sp"></span><span class="small muted" v-if="board">{{ total }} кандидатов · {{ groups.length }} ниш</span></div>

    <Skel v-if="!board" :rows="8"/>
    <div v-else-if="!groups.length" class="card"><Empty icon="target" text="Под этот фильтр кандидатов нет"/></div>

    <!-- all niches: compact cards, one click into a niche -->
    <div v-else-if="!cur" class="niche-grid">
      <a v-for="G in groups" :key="G.name" class="card niche-card" :href="'#/home/' + encodeURIComponent(G.name)">
        <div class="row" style="gap:8px;flex-wrap:nowrap;align-items:baseline"><h2>{{ G.name }}</h2><span class="sp"></span><span class="chip p">{{ G.items.length }}</span></div>
        <div class="nc-desc">{{ G.description || 'Описание появится после следующей группировки ниш' }}</div>
        <div class="row" style="gap:0;margin-top:auto"><span class="nc-avs"><Av v-for="p in G.items.slice(0, 5)" :key="p.username" :u="p.username" :src="p.avatar" size="sm"/></span>
          <span class="sp"></span><span class="small muted">{{ G.posts }} размещ. · до {{ fmt(G.items[0].followers) }}</span></div>
      </a>
    </div>

    <!-- one niche -->
    <div v-else-if="!G" class="card"><Empty icon="target" text="В этой нише под текущий фильтр никого нет"/>
      <div style="text-align:center"><a class="btn sm" href="#/home"><Icon name="arrow-right" style="transform:rotate(180deg)"/>Все ниши</a></div></div>
    <template v-else>
      <div class="row" style="gap:6px;margin-bottom:12px"><a class="btn sm" href="#/home"><Icon name="arrow-right" style="transform:rotate(180deg)"/>Все ниши</a>
        <a v-for="g in groups" :key="g.name" :href="'#/home/' + encodeURIComponent(g.name)" :class="['chip', g.name === cur ? 'p' : '']">{{ g.name }} · {{ g.items.length }}</a></div>
    <div class="card">
      <div class="row" style="gap:8px;align-items:baseline"><h2 style="margin:0;font:600 18px/1.3 var(--mono);color:var(--heading);text-transform:capitalize">{{ G.name }}</h2>
        <span class="chip p">{{ G.items.length }}</span><span class="small muted">{{ G.posts }} размещ. в фокусе</span></div>
      <div class="small muted" style="margin:4px 0 10px" v-if="G.description">{{ G.description }}</div>
      <div class="tbl"><table><tr><th>Кандидат</th><th class="num">Подписчики</th><th>Воронка</th><th>Где рекламировался</th><th></th></tr>
        <tr v-for="p in G.items" :key="p.username">
          <td style="max-width:340px"><Who :u="p.username" :src="p.avatar" :sub="[p.niche, p.full_name].filter(Boolean).join(' · ')"/>
            <div class="bio" style="margin-top:4px">{{ p.bio }}</div></td>
          <td class="num"><b style="font:600 16px var(--mono)">{{ fmt(p.followers) }}</b></td>
          <td><span class="chip c" v-if="p.funnel && p.funnel!=='none'">{{ p.funnel }}</span></td>
          <td class="small"><b>{{ p.focus_posts }}</b> размещ. в {{ p.focus_publics }} паблик{{ p.focus_publics === 1 ? 'е' : 'ах' }} · <span class="dim">последнее {{ day(p.focus_last) }}</span>
            <div class="row" style="gap:4px;margin-top:4px"><a v-for="f in p.focus_names.slice(0, 5)" :key="f" :href="'#/a/' + f" class="chip c">@{{ f }}</a>
              <span v-if="p.focus_names.length > 5" class="dim">+{{ p.focus_names.length - 5 }}</span></div></td>
          <td style="white-space:nowrap"><div class="row" style="gap:6px;flex-wrap:nowrap">
            <span v-if="p.role==='project'" class="chip p">отслеживается</span>
            <button v-else class="btn good sm" @click="track(p)"><Icon name="check" size="sm"/>Отслеживать</button>
            <Vote v-if="p.role!=='project'" :u="p.username" :vote="p.vote" via="home" @voted="v => v === -1 && load()"/>
            <a class="btn sm icon ghost" :href="'#/a/' + p.username" title="Карточка" :aria-label="'Карточка @' + p.username"><Icon name="arrow-right"/></a></div></td>
        </tr></table></div>
    </div>
    </template>
  </div>`,
  props: ['arg'],
  components: { Who, Vote, Av },
  setup(props) {
    const SIZES = [['', 'Все'], ['big', 'больше 100K'], ['small', 'меньше 100K']];
    // filters survive going into a niche and back (the page is re-created on every route change)
    const keep = (k, v) => { const r = ref(store['home_' + k] ?? v); watch(r, x => store['home_' + k] = x); return r; };
    const board = ref(null), q = keep('q', ''), size = keep('size', ''), showTracked = keep('tracked', false);
    const cur = props.arg || null;
    const load = async () => { board.value = await api('/api/niche-board'); };
    const pass = p => (showTracked.value || p.role !== 'project') &&
      (!size.value || (size.value === 'big' ? (p.followers || 0) >= 1e5 : (p.followers || 0) < 1e5)) &&
      (!q.value || [p.username, p.bio, p.niche, p.full_name].join(' ').toLowerCase().includes(q.value.toLowerCase()));
    // only accounts with placements in focus; inside a niche — by followers (already sorted by the API)
    const groups = computed(() => (board.value || []).map(G => {
      const items = G.placed.filter(pass);
      return { ...G, items, posts: items.reduce((s, p) => s + p.focus_posts, 0) };
    }).filter(G => G.items.length).sort((a, b) => b.items.length - a.items.length || b.posts - a.posts));
    const total = computed(() => groups.value.reduce((s, G) => s + G.items.length, 0));
    const G = computed(() => groups.value.find(g => g.name === cur));
    async function track(p) { await api('/api/accounts', { method: 'POST', body: { usernames: [p.username], role: 'project' } }); toast('@' + p.username + ' отслеживается: рост, размещения, контент'); load(); }
    async function discover() {
      if (!confirm('Один прогон с поиском проектов вне фокуса (разведка площадок, поиск по словам). Тратит страницы Instagram-сессии и запросы ИИ. Запустить?')) return;
      try { await api('/api/run?kind=discover', { method: 'POST' }); toast('Ищу новые проекты вне фокуса'); refreshState(); } catch (e) { toast(e.message, true); }
    }
    onMounted(load);
    watch(() => store.st?.pipeline.running, (v, old) => { if (old && !v) load(); });
    return { SIZES, board, q, size, showTracked, groups, total, cur, G, load, track, discover, runNow, st: computed(() => store.st), ...H };
  },
};

const Dashboard = {
  components: { Who, Av },
  template: `
  <div>
    <div class="head"><h1>Дашборд</h1><span class="sub">кто, где и как переливает трафик</span><span class="sp"></span>
      <button class="btn primary" :disabled="st?.pipeline.running" @click="runNow"><Icon :name="st?.pipeline.running ? 'loader-circle' : 'play'" :spin="st?.pipeline.running"/>{{ st?.pipeline.running ? 'Идёт анализ…' : 'Запустить анализ' }}</button></div>

    <div class="card" style="margin-bottom:16px" v-if="st">
      <div v-if="st.pipeline.running">
        <div class="row" style="margin-bottom:10px"><span class="pulse"></span><b>{{ st.pipeline.stage }}</b>
          <span class="muted" v-if="st.pipeline.total">{{ st.pipeline.done }} / {{ st.pipeline.total }}</span><span class="sp"></span>
          <a href="#/runs" class="small muted row" style="gap:4px">журнал <Icon name="arrow-right" size="sm"/></a></div>
        <div class="progress"><div :style="{width: (st.pipeline.total ? st.pipeline.done / st.pipeline.total * 100 : 5) + '%'}"></div></div>
        <div class="small muted" style="margin-top:8px">{{ st.pipeline.message }}</div>
      </div>
      <div v-else class="row"><Icon name="calendar" class="dim"/>
        <span>Следующий авто-анализ: <b>{{ dt(st.schedule.next) }}</b> <span class="muted">({{ st.schedule.reason }})</span></span></div>
      <div class="status-line" style="margin-top:12px">
        <span>Instagram-сессия: <b :style="{color: st.pipeline.session.ok ? 'var(--good)' : st.pipeline.session.ok === false ? 'var(--bad)' : 'var(--muted)'}">{{ st.pipeline.session.message }}</b></span>
        <span>ИИ: <b>{{ st.llm.provider === 'ollama' ? 'Ollama' : 'Gemini' }}</b></span>
        <span>Gemini сегодня: <b>{{ st.gemini.requests }}</b> / {{ st.gemini.cap }} запросов</span>
        <span v-if="st.llm.ollama.requests">Ollama сегодня: <b>{{ st.llm.ollama.requests }}</b> пачек</span>
        <span>Apify сегодня: <b>{{ '$' + st.apify.usd.toFixed(3) }}</b> / {{ '$' + st.apify.cap }}</span>
        <span>Авто-прогонов сегодня: <b>{{ st.schedule.auto_today }}</b></span>
      </div>
    </div>

    <Skel v-if="!d" :blocks="6" :rows="6"/>
    <div class="kpis" v-if="d">
      <a href="#/focus" class="card kpi"><div class="v">{{ d.focus }}</div><div class="l">фокус-пабликов</div></a>
      <a href="#/projects" class="card kpi accent"><div class="v">{{ d.projects }}</div><div class="l">проектов в анализе</div></a>
      <a href="#/candidates" class="card kpi"><div class="v">{{ d.found_projects }}</div><div class="l">найдено похожих на проект</div></a>
      <a href="#/focus/suggest" class="card kpi"><div class="v">{{ d.suggestions }}</div><div class="l">предложений: проекты и площадки</div></a>
      <a href="#/niches" class="card kpi"><div class="v">{{ d.niches }}</div><div class="l">ниш</div></a>
      <div class="card kpi"><div class="v">{{ fmt(d.posts) }}</div><div class="l">постов в базе · +{{ d.posts_24h }} за сутки</div></div>
      <a href="#/candidates" class="card kpi"><div class="v">{{ d.q_unopened }}</div><div class="l">кандидатов ждут проверки · {{ d.q_unclassified }} у ИИ</div></a>
      <a href="#/candidates/hot" class="card kpi" v-if="d.q_hot"><div class="v"><Icon name="flame" size="lg" style="color:var(--accent)"/>{{ d.q_hot }}</div><div class="l">из очереди ИИ считает проектами</div></a>
    </div>
    <div class="help" v-if="d && d.focus_unscanned" style="margin:-6px 0 14px">Ещё не сканировано фокус-пабликов: {{ d.focus_unscanned }}. Паблики проверяются по кругу (сколько за прогон — в Настройках), сначала новые и давно не проверенные.</div>

    <div class="card" v-if="d && d.affiliates.length" style="margin-bottom:16px">
      <h3>Кому паблики продают трафик · партнёрские ссылки в био</h3>
      <div class="help" style="margin-bottom:10px">Ссылка в био паблика ведёт на чужой бренд с партнёрским кодом (clipping=, affiliateId=, ref=…). Короткие ссылки раскрываются автоматически. Один код у многих пабликов означает одну сеть, которая продаёт аудиторию одному рекламодателю. Такую рекламу не видно в постах: она живёт в ссылке в био.</div>
      <table><tr><th>Рекламодатель</th><th class="num">Пабликов</th><th class="num">Из них фокус</th><th class="num">Аудитория</th><th>Паблики</th><th>Партнёрский код</th></tr>
        <tr v-for="a in d.affiliates" :key="a.domain"><td><a :href="'https://' + a.domain" target="_blank"><b>{{ a.domain }}</b></a></td>
          <td class="num"><b>{{ a.n }}</b></td><td class="num">{{ a.focus || '' }}</td><td class="num">{{ fmt(a.audience) }}</td>
          <td class="small"><a v-for="p in a.publics.slice(0, 10)" :href="'#/a/' + p.username" :class="['chip', p.role === 'focus' ? 'c' : '']" style="margin:0 4px 4px 0">@{{ p.username }}</a>
            <span v-if="a.publics.length > 10" class="dim">+{{ a.publics.length - 10 }}</span></td>
          <td class="small dim">{{ a.ids.join(', ') }}</td></tr></table>
    </div>

    <div class="split" v-if="d">
      <div class="card"><h3>Самые рекламируемые проекты · 30 дней</h3>
        <table v-if="d.top_projects.length"><tr><th>Проект</th><th>Ниша</th><th class="num">Подписчики</th><th class="num">Реклам</th></tr>
          <tr v-for="p in d.top_projects" class="click" @click="go(p.username)">
            <td><Who :u="p.username" :src="p.avatar"/></td><td><span class="chip p" v-if="p.niche">{{ p.niche }}</span></td>
            <td class="num">{{ fmt(p.followers) }}</td><td class="num"><b>{{ p.ads }}</b></td></tr></table>
        <Empty v-else icon="radar" text="Данные появятся после первого анализа"/>
      </div>
      <div class="card"><h3>Свежие размещения</h3>
        <div v-if="d.recent_ads.length" style="display:flex;flex-direction:column;gap:10px">
          <div v-for="a in d.recent_ads" class="row" style="flex-wrap:nowrap">
            <a :href="postUrl(a.code)" target="_blank" class="chip">{{ day(a.taken_at) }}</a>
            <span class="small row" style="gap:4px;flex-wrap:nowrap;min-width:0"><a :href="'#/a/' + a.owner"><b>@{{ a.owner }}</b></a><Icon name="arrow-right" size="sm" class="dim"/>
              <a :href="'#/a/' + a.target" :style="{color: a.target_role === 'project' ? 'var(--primary)' : 'var(--violet)', fontWeight: 600}">@{{ a.target }}</a></span>
            <span class="sp"></span><span class="dim small row" style="gap:3px;flex-wrap:nowrap" v-if="a.likes != null"><Icon name="heart" size="sm"/>{{ fmt(a.likes) }}</span></div>
        </div>
        <Empty v-else icon="megaphone" text="Размещений пока нет"/>
      </div>
    </div>
  </div>`,
  setup() {
    const d = ref(null);
    const load = async () => d.value = await api('/api/dashboard');
    onMounted(load);
    watch(() => store.st?.pipeline.running, (v, old) => { if (old && !v) load(); });
    return { d, st: computed(() => store.st), runNow, go: u => location.hash = '#/a/' + u, ...H };
  },
};

const Focus = {
  components: { Who, Links, Vote, Taste },
  props: ['arg'],
  template: `
  <div>
    <div class="head"><h1>Фокус</h1><span class="sub">что анализируем и что предлагаем добавить</span></div>
    <div class="card" style="margin-bottom:16px">
      <div class="row" style="align-items:flex-start;flex-wrap:nowrap;gap:14px">
        <textarea v-model="addText" placeholder="Ссылки или @username — по одному в строке (можно сразу пачкой)" style="min-height:64px;font-family:inherit"></textarea>
        <div style="display:flex;flex-direction:column;gap:8px;min-width:190px">
          <select v-model="addRole"><option value="focus">в фокус-паблики</option><option value="project">в проекты</option></select>
          <button class="btn primary" @click="add" :disabled="!addText.trim()"><Icon name="plus"/>Добавить</button></div></div>
      <div class="help" style="margin-top:8px">Фокус-паблики — где смотрим, что рекламируется. Проекты — кого отслеживаем: где их рекламили, рост подписчиков, кому они переливают.</div>
    </div>
    <div class="tabs">
      <button :class="{on: tab==='focus'}" @click="tab='focus'"><Icon name="radar"/>Паблики · {{ data?.focus.length ?? '' }}</button>
      <button :class="{on: tab==='projects'}" @click="tab='projects'"><Icon name="briefcase"/>Проекты · {{ data?.projects.length ?? '' }}</button>
      <button :class="{on: tab==='suggest'}" @click="tab='suggest'"><Icon name="sparkles"/>Предложения <span class="badge" v-if="data?.suggestions.length">{{ data.suggestions.length }}</span></button>
    </div>
    <Skel v-if="!data" :rows="8"/>

    <div class="card" v-if="data && tab==='focus'">
      <table><tr><th>Паблик</th><th class="num">Подписчики</th><th class="num">Постов собрано</th><th class="num">Упомянуто акк.</th><th class="num">Из них проектов</th><th>Скан</th><th></th></tr>
        <tr v-for="a in data.focus" :key="a.username"><td><Who :u="a.username" :src="a.avatar" :sub="a.full_name"/></td>
          <td class="num">{{ fmt(a.followers) }}</td><td class="num">{{ a.posts }}</td><td class="num">{{ a.promoted }}</td>
          <td class="num"><b :style="{color: a.promoted_projects ? 'var(--primary)' : 'var(--dim)'}">{{ a.promoted_projects }}</b></td>
          <td class="small"><span v-if="a.error" class="chip r" :title="a.error">ошибка</span><span v-else class="muted">{{ a.timeline_at ? ago(a.timeline_at) : 'в очереди' }}</span></td>
          <td class="num"><button class="btn sm" @click="setRole(a.username, 'candidate')">Убрать</button></td></tr></table>
    </div>

    <div class="card" v-if="data && tab==='projects'">
      <table><tr><th>Проект</th><th>Ниша</th><th>Воронка</th><th class="num">Подписчики</th><th class="num">Реклам</th><th class="num">Площадок</th><th>Скан</th><th></th></tr>
        <tr v-for="a in data.projects" :key="a.username" class="click" @click="go(a.username)"><td><Who :u="a.username" :src="a.avatar" :sub="a.full_name"/></td>
          <td><span class="chip p" v-if="a.niche">{{ a.niche }}</span></td><td class="small muted">{{ a.funnel || '' }}</td>
          <td class="num">{{ fmt(a.followers) }}</td><td class="num"><b>{{ a.ads }}</b></td><td class="num">{{ a.sources }}</td>
          <td class="small"><span v-if="a.restricted" class="chip w">18+</span> <span v-if="a.error" class="chip r" :title="a.error">ошибка</span><span v-else class="muted">{{ ago(a.tagged_at) }}</span></td>
          <td class="num"><button class="btn sm" @click.stop="setRole(a.username, 'candidate')">Убрать</button></td></tr></table>
      <Empty v-if="!data.projects.length" icon="briefcase" text="Нет проектов — добавь вручную выше или прими из «Предложений»"/>
    </div>

    <div v-if="data && tab==='suggest'">
      <div v-for="grp in groups" :key="grp.t" style="margin-bottom:22px">
        <h3 class="lg-title row" style="gap:6px;margin:4px 0 10px"><Icon v-if="grp.icon" :name="grp.icon" size="sm"/>{{ grp.title }} · {{ grp.items.length }}</h3>
        <div class="cards" v-if="grp.items.length">
          <div class="card" v-for="s in grp.items" :key="s.username + s.target" style="display:flex;flex-direction:column;gap:10px">
            <Who :u="s.username" :src="s.avatar" :sub="(s.full_name || '') + ' · ' + fmt(s.followers)"/>
            <div class="row" style="gap:6px"><span class="chip p" v-if="s.niche">{{ s.niche }}</span><span class="chip" v-if="s.persona && s.persona!=='unknown'">{{ s.persona === 'face' ? 'с лицом' : 'faceless' }}</span>
              <span class="chip c" v-if="s.funnel && s.funnel!=='none'">→ {{ s.funnel }}</span><Taste v-if="s.target==='project'" :t="s.taste"/>
              <span class="chip" v-if="s.region && REGION[s.region]">{{ REGION[s.region] }}</span><span class="chip" v-if="s.lang && s.lang !== 'unknown' && s.lang !== 'en'">{{ s.lang }}</span></div>
            <div class="small row" style="gap:5px;color:var(--good)" v-if="s.target==='project' && s.focus_posts"><Icon name="target" size="sm"/><b>размещений в фокус-пабликах: {{ s.focus_posts }}</b></div>
            <div class="small">{{ s.reason }}</div>
            <div class="bio" v-if="s.bio">{{ s.bio }}</div>
            <Links :links="s.links"/>
            <div class="small dim" v-if="s.via">найден через <span v-if="s.via.startsWith('🔎')">поиск «{{ s.via.slice(2).trim() }}»</span>
              <a v-else :href="'#/a/' + s.via">@{{ s.via }}</a></div>
            <div class="row"><button class="btn good sm" @click="act(s, 'accept')"><Icon name="check" size="sm"/>{{ s.target === 'focus' ? 'В фокус' : 'Отслеживать' }}</button>
              <button class="btn sm" @click="act(s, 'dismiss')">Скрыть</button><span class="sp"></span>
              <Vote v-if="s.target==='project'" :u="s.username" :vote="s.vote" :reason="s.vote_reason" via="suggestion" @voted="v => v === -1 && load()"/></div>
          </div></div>
        <div v-else class="card"><Empty :icon="grp.icon || 'info'" :text="grp.empty"/></div>
      </div>
    </div>
  </div>`,
  setup(props) {
    const data = ref(null), tab = ref(props.arg === 'suggest' ? 'suggest' : 'focus'), addText = ref(''), addRole = ref('focus');
    const load = async () => data.value = await api('/api/focus');
    const groups = computed(() => !data.value ? [] : [
      { t: 'project', icon: 'target', title: 'Новые проекты, которые рекламировались в фокус-пабликах', empty: 'Нет новых проектов из фокуса', items: data.value.suggestions.filter(s => s.target === 'project' && s.focus_posts) },
      { t: 'project_other', icon: 'search', title: 'Новые проекты без размещений в фокусе (поиск, разведка) — второстепенные', empty: 'Нет', items: data.value.suggestions.filter(s => s.target === 'project' && !s.focus_posts) },
      { t: 'focus', icon: 'radar', title: 'Площадки, где рекламируются наши проекты — в фокус', empty: 'Нет предложений', items: data.value.suggestions.filter(s => s.target === 'focus' && !s.satellite) },
    ]);
    async function add() {
      try {
        const r = await api('/api/accounts', { method: 'POST', body: { usernames: addText.value.split(/[\n,\s]+/), role: addRole.value } });
        toast('Добавлено: ' + r.added.map(x => '@' + x).join(', ') + '. Данные появятся после следующего анализа');
        addText.value = ''; load();
      } catch (e) { toast(e.message, true); }
    }
    async function setRole(u, role) { await api('/api/accounts/' + u, { method: 'PATCH', body: { role } }); toast('@' + u + ' убран из списка'); load(); }
    async function act(s, a) { await api(`/api/suggestions/${s.username}/${s.target}/${a}`, { method: 'POST' }); load(); }
    onMounted(load);
    return { data, tab, addText, addRole, add, setRole, act, groups, load, go: u => location.hash = '#/a/' + u, ...H };
  },
};

// Project breakdown block (LLM): used on Finds cards and on the account page.
const Teardown = {
  props: ['t'],
  template: `<div class="teardown">
    <div style="margin-bottom:8px">{{ t.summary }}</div>
    <div class="grid g2" style="gap:12px">
      <div><div class="lg-title">Что продаёт</div><div>{{ t.offer }}</div><div class="small muted" style="margin-top:3px">Цена: {{ t.price }} · Аудитория: {{ t.audience }}</div></div>
      <div><div class="lg-title">Воронка</div><ol style="margin:0;padding-left:18px"><li v-for="x in t.funnel_steps">{{ x }}</li></ol></div>
      <div><div class="lg-title">Рубрики контента</div><ul style="margin:0;padding-left:18px"><li v-for="x in t.content_pillars">{{ x }}</li></ul></div>
      <div><div class="lg-title">Что залетает</div><ul style="margin:0;padding-left:18px;color:var(--good)"><li v-for="x in t.best_formats"><span style="color:var(--text)">{{ x }}</span></li></ul></div>
      <div><div class="lg-title">Зацепки</div><ul style="margin:0;padding-left:18px"><li v-for="x in t.hooks">{{ x }}</li></ul></div>
      <div><div class="lg-title">Как сделать похожий</div><div>{{ t.how_to_copy }}</div><div class="small" style="margin-top:6px;color:var(--bad)">Риски: {{ t.risks }}</div></div>
    </div>
    <div class="small dim" style="margin-top:8px">Разбор ИИ по био, ссылкам, его постам и размещениям · {{ dt(t.ts) }}</div></div>`,
  methods: { dt },
};

const Viral = {
  template: `
  <div>
    <div class="head"><h1>Залетевшее</h1><span class="sub">посты фокус-пабликов, набравшие в {{ d?.ratio }}+ раз больше обычного для своего паблика · {{ d?.days }} дней</span><span class="sp"></span>
      <button class="btn" :disabled="st?.pipeline.running" @click="contentRun"><Icon name="microscope"/>Собрать просмотры и разборы</button>
      <button class="btn primary" :disabled="!shown.length || dls?.running" @click="download"><Icon name="download"/>Скачать отобранное ({{ Math.min(shown.length, 500) }})</button></div>
    <Skel v-if="!d" :blocks="4" :rows="6"/>
    <div class="help" style="margin:-8px 0 12px" v-if="d">Каждый паблик сравнивается только сам с собой: с медианой своих постов по просмотрам reels или лайкам + комментариям. Поэтому маленький и огромный паблик оцениваются честно.
      Просмотры reels собраны у {{ d.with_views }} постов. Если их мало, нажми «Собрать просмотры и разборы». Формат и тему ИИ определяет по подписи и типу поста, само видео он не смотрит.
      <span v-if="dls && dls.username==='viral' && dls.message"> · {{ dls.message }} <a href="" @click.prevent="openFolder">открыть папку</a></span></div>

    <div class="grid g2" style="margin-bottom:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))" v-if="d">
      <div class="card"><h3>Форматы</h3><div class="row" style="gap:5px"><a v-for="x in d.summary.formats" href="" @click.prevent="toggle('format', x.name)" :class="['chip', f.format===x.name ? 'p' : '']">{{ x.name }} · {{ x.n }} <span class="dim">×{{ x.avg }}</span></a>
        <span v-if="!d.summary.formats.length" class="dim small">ИИ ещё не разметил ({{ d.summary.tagged }}/{{ d.summary.total }})</span></div></div>
      <div class="card"><h3>Темы</h3><div class="row" style="gap:5px"><a v-for="x in d.summary.topics" href="" @click.prevent="toggle('topic', x.name)" :class="['chip', f.topic===x.name ? 'p' : '']">{{ x.name }} · {{ x.n }}</a></div></div>
      <div class="card"><h3>Тип поста</h3><div class="row" style="gap:5px"><a v-for="x in d.summary.types" href="" @click.prevent="toggle('type', x.name)" :class="['chip', f.type===x.name ? 'p' : '']">{{ x.name }} · {{ x.n }} <span class="dim">×{{ x.avg }}</span></a></div></div>
      <div class="card"><h3>Чаще всего залетает у</h3><div class="row" style="gap:5px"><a v-for="x in d.summary.owners.slice(0, 12)" href="" @click.prevent="toggle('owner', x.name)" :class="['chip', f.owner===x.name ? 'p' : 'c']">@{{ x.name }} · {{ x.n }}</a></div></div>
    </div>
    <div class="row" style="margin-bottom:10px;gap:8px" v-if="Object.values(f).some(Boolean)"><span class="small muted">Фильтр:</span>
      <button v-for="(v, k) in f" v-show="v" :key="k" class="chip p" style="cursor:pointer;border:0" @click="f[k] = null" :aria-label="'Убрать фильтр ' + v">{{ v }}<Icon name="x" size="sm"/></button></div>

    <div class="feed" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">
      <div v-for="p in shown.slice(0, limit)" :key="p.pk" class="vcard">
        <a :href="postUrl(p.code)" target="_blank" class="post" :title="p.caption">
          <img v-if="p.image && !p._broken" :src="p.image" referrerpolicy="no-referrer" loading="lazy" @error="p._broken = true">
          <div v-else class="ph">{{ (p.caption || '').slice(0, 90) }}</div>
          <span class="chip g n-media" :title="'В ' + p.ratio + ' раз выше обычного для паблика'">×{{ p.ratio }}</span>
          <span class="chip n-media">{{ p.type }}</span>
          <div class="cap"><b>@{{ p.owner }}</b> · {{ day(p.taken_at) }}
            <div class="row" style="gap:8px;margin-top:2px"><span v-if="p.views" class="row" style="gap:3px"><Icon name="play" size="sm"/>{{ fmt(p.views) }}</span>
              <span v-if="p.likes != null" class="row" style="gap:3px"><Icon name="heart" size="sm"/>{{ fmt(p.likes) }}</span>
              <span class="row" style="gap:3px"><Icon name="message-circle" size="sm"/>{{ fmt(p.comments) }}</span></div></div></a>
        <div class="meta">
          <div class="row" style="gap:4px"><span class="chip p" v-if="p.format">{{ p.format }}</span><span class="chip" v-if="p.topic">{{ p.topic }}</span>
            <span class="chip w" v-if="p.advertises.length" :title="'В посте отмечен: ' + p.advertises.join(', ')"><Icon name="megaphone" size="sm"/>@{{ p.advertises[0] }}</span></div>
          <div v-if="p.hook"><span class="dim">Зацепка:</span> {{ p.hook }}</div>
          <div v-if="p.why" class="muted">{{ p.why }}</div>
          <div class="dim">по метрике «{{ p.by }}»: обычно {{ fmt(p.median) }}</div></div>
      </div>
    </div>
    <div v-if="d && !shown.length" class="card"><Empty icon="flame" text="Под этот фильтр залетевших постов нет — сними фильтр выше или собери просмотры"/></div>
    <div v-if="shown.length > limit" style="text-align:center;margin-top:12px"><button class="btn sm" @click="limit += 60">Показать ещё ({{ shown.length - limit }})</button></div>
  </div>`,
  setup() {
    const d = ref(null), limit = ref(60), f = reactive({ format: null, topic: null, type: null, owner: null });
    const load = async () => d.value = await api('/api/viral');
    const shown = computed(() => (d.value?.items || []).filter(p => Object.entries(f).every(([k, v]) => !v || p[k] === v)));
    const toggle = (k, v) => { f[k] = f[k] === v ? null : v; limit.value = 60; };
    async function download() {
      try { await api('/api/download-posts', { method: 'POST', body: { pks: shown.value.slice(0, 500).map(p => p.pk), name: 'viral' } }); toast('Скачиваю залетевшее'); refreshState(); }
      catch (e) { toast(e.message, true); }
    }
    async function contentRun() {
      try { await api('/api/run?kind=content', { method: 'POST' }); toast('Собираю просмотры reels и ленты проектов, потом ИИ разметит посты и сделает разборы'); refreshState(); }
      catch (e) { toast(e.message, true); }
    }
    const openFolder = () => api('/api/open-folder', { method: 'POST' });
    onMounted(load);
    return { d, f, limit, shown, toggle, download, contentRun, openFolder, st: computed(() => store.st), dls: computed(() => store.st?.download), ...H };
  },
};

const CATEGORY = { project: 'проект', ad_brand: 'реклама бренда', clipper: 'клиппер', media: 'медиа / мемы', artist: 'артист / звезда', person: 'человек', other: 'прочее' };

const Finds = {
  components: { Who, Links, Vote, Taste, Teardown },
  props: ['arg'],
  template: `
  <div>
    <div class="head"><h1>Находки</h1><span class="sub">проекты, которые рекламировались в твоих фокус-пабликах, отдельно от обычной рекламы</span></div>
    <div class="tabs">
      <button :class="{on: tab==='in_focus'}" @click="tab='in_focus'"><Icon name="target"/>Проекты в фокусе · {{ d?.in_focus.length ?? '' }}</button>
      <button :class="{on: tab==='ads'}" @click="tab='ads'"><Icon name="megaphone"/>Реклама в фокусе · {{ d ? d.ads.length + d.bio_ads.length : '' }}</button>
      <button :class="{on: tab==='elsewhere'}" @click="tab='elsewhere'"><Icon name="search"/>Без размещений в фокусе · {{ d?.elsewhere.length ?? '' }}</button>
    </div>
    <Skel v-if="!d" :rows="8"/>

    <div v-if="d && tab==='in_focus'">
      <div class="row" style="margin-bottom:12px;gap:12px"><div class="help" style="flex:1 1 320px">Главное: люди и faceless-страницы со своей воронкой (как kayans.trade, dpattofficial, kingcap702), которых рекламировали твои фокус-паблики. Сортировка: сколько разных фокус-пабликов их рекламировали, потом число размещений. Подписчики этих проектов снимаются каждые 3 часа, чтобы видеть рост после размещений.</div>
        <button class="btn" :disabled="st?.pipeline.running" @click="contentRun"><Icon name="microscope"/>Собрать контент и разборы</button></div>
      <div class="row" style="gap:8px;margin-bottom:12px"><span class="small muted">Ниши:</span>
        <button v-for="g in nicheGroups" :key="g.niche" :class="['chip', nicheSel === g.niche ? 'p' : '']" style="cursor:pointer"
          @click="nicheSel = nicheSel === g.niche ? null : g.niche">{{ g.niche }} · {{ g.items.length }} пр. · {{ g.posts }} разм.</button></div>
      <template v-for="g in nicheGroups.filter(x => !nicheSel || x.niche === nicheSel)" :key="g.niche">
      <h3 class="lg-title row" style="gap:6px;margin:14px 0 8px"><Icon name="layers" size="sm"/>{{ g.niche }} · {{ g.items.length }} проект(ов) · {{ g.posts }} размещений</h3>
      <div class="card" v-for="p in g.items" :key="p.username" style="margin-bottom:10px">
        <div class="find-row">
          <div><Who :u="p.username" :src="p.avatar" :sub="fmt(p.followers) + ' · ' + (p.full_name || '')"/>
            <div class="row" style="gap:5px;margin-top:8px"><span v-if="p.role==='project'" class="chip p">отслеживается</span>
              <span class="chip p" v-if="p.niche">{{ p.niche }}</span><span class="chip c" v-if="p.funnel && p.funnel!=='none'">→ {{ p.funnel }}</span>
              <span class="chip" v-if="p.region && REGION[p.region]">{{ REGION[p.region] }}</span>
              <span class="chip w" v-if="p.kind==='filtered'" :title="p.filter_reason">вне фильтра</span></div></div>
          <div style="min-width:0"><div class="bio">{{ p.bio }}</div><Links :links="p.links" style="margin-top:6px"/>
            <div class="small muted row" v-if="p.reason" style="margin-top:6px;gap:5px;flex-wrap:nowrap;align-items:flex-start"><Icon name="bot" size="sm" style="margin-top:2px"/><span>{{ p.reason }}</span></div>
            <div style="margin-top:10px"><button v-if="p.teardown" class="btn sm" :aria-expanded="!!open[p.username]" @click="open[p.username] = !open[p.username]">
                <Icon :name="open[p.username] ? 'chevron-down' : 'chevron-right'" size="sm"/><Icon name="microscope" size="sm"/>{{ open[p.username] ? 'Скрыть разбор' : 'Разбор проекта: как устроен и что залетает' }}</button>
              <span v-else class="small dim">Разбор появится после сбора его постов (сейчас {{ p.own_posts }}, нужно 6+): кнопка «Собрать контент» сверху или следующий анализ</span></div>
            <Teardown v-if="p.teardown && open[p.username]" :t="p.teardown" style="margin-top:8px"/></div>
          <div>
            <div><b style="font:600 22px/1.2 var(--mono);color:var(--heading)">{{ p.focus_posts }}</b> <span class="muted small">размещ. в {{ p.focus_publics }} фокус-паблик{{ p.focus_publics === 1 ? 'е' : 'ах' }}</span></div>
            <div class="small dim">{{ day(p.focus_first) }} — {{ day(p.focus_last) }}</div>
            <div class="row" style="gap:4px;margin-top:6px"><a v-for="f in p.focus_names" :href="'#/a/' + f" class="chip c">@{{ f }}</a></div>
            <div class="small dim" v-if="p.all_posts > p.focus_posts" style="margin-top:4px">+ ещё {{ p.all_posts - p.focus_posts }} размещ. вне фокуса</div>
            <div class="row" style="margin-top:8px"><button v-if="p.role!=='project'" class="btn good sm" @click="track(p)">Отслеживать</button>
              <a class="btn sm" :href="'#/a/' + p.username">Карточка<Icon name="arrow-right" size="sm"/></a><span class="sp"></span>
              <Vote v-if="p.role!=='project'" :u="p.username" :vote="p.vote" :reason="p.vote_reason" via="finds" @voted="v => v === -1 && load()"/></div>
          </div></div>
      </div>
      </template>
      <div v-if="!d.in_focus.length" class="card"><Empty icon="target" text="Пока нет проектов с размещениями в фокус-пабликах. Они появятся, когда анализ разберёт рекламу пабликов."/></div>
    </div>

    <div v-if="d && tab==='ads'">
      <div class="help" style="margin-bottom:12px">Это не проекты, а обычная реклама в твоих фокус-пабликах: бренды, приложения, игры, казино, букмекеры. Видно, кто и где покупает размещения.</div>
      <div class="card" style="margin-bottom:14px" v-if="d.bio_ads.length"><h3>Через ссылку в био пабликов (партнёрки)</h3>
        <table><tr><th>Рекламодатель</th><th class="num">Пабликов</th><th class="num">Из них фокус</th><th class="num">Аудитория</th><th>Паблики</th></tr>
          <tr v-for="a in d.bio_ads" :key="a.domain"><td><a :href="'https://' + a.domain" target="_blank"><b>{{ a.domain }}</b></a></td>
            <td class="num">{{ a.n }}</td><td class="num"><b>{{ a.focus }}</b></td><td class="num">{{ fmt(a.audience) }}</td>
            <td class="small"><a v-for="p in a.publics" :href="'#/a/' + p.username" :class="['chip', p.role === 'focus' ? 'c' : '']" style="margin:0 4px 4px 0">@{{ p.username }}</a></td></tr></table></div>
      <div class="card"><h3>Отмечены в постах фокус-пабликов</h3>
        <table><tr><th>Бренд</th><th class="num">Размещений</th><th class="num">Пабликов</th><th>Где</th><th>Последнее</th></tr>
          <tr v-for="a in d.ads" :key="a.username"><td style="max-width:300px"><Who :u="a.username" :src="a.avatar" :sub="fmt(a.followers) + ' · ' + (a.reason || '')"/></td>
            <td class="num"><b>{{ a.focus_posts }}</b></td><td class="num">{{ a.focus_publics }}</td>
            <td class="small"><a v-for="f in a.focus_names.slice(0, 6)" :href="'#/a/' + f" class="chip c" style="margin:0 4px 4px 0">@{{ f }}</a></td>
            <td class="small muted">{{ day(a.focus_last) }}</td></tr></table>
        <Empty v-if="!d.ads.length" icon="megaphone" text="Рекламы брендов в фокус-пабликах пока не найдено"/>
        <div class="help" style="margin-top:8px" v-if="d.uncategorized">Ещё {{ d.uncategorized }} проверенных аккаунтов без категории: они разберутся в следующих прогонах.</div></div>
    </div>

    <div v-if="d && tab==='elsewhere'">
      <div class="help" style="margin-bottom:12px">Похожи на проект, но в твоих фокус-пабликах не рекламировались: найдены поиском по словам или разведкой. Это второстепенный список. Если такой проект потом появится в рекламе фокус-пабликов, он сам перейдёт на вкладку «Проекты в фокусе».</div>
      <div class="card"><table><tr><th>Проект</th><th>Описание</th><th>Откуда</th><th></th></tr>
        <tr v-for="p in d.elsewhere" :key="p.username"><td style="max-width:240px"><Who :u="p.username" :src="p.avatar" :sub="fmt(p.followers) + ' · ' + (p.niche || '')"/></td>
          <td style="max-width:420px"><div class="bio">{{ p.bio }}</div></td>
          <td class="small"><span v-if="p.all_posts" class="muted">размещ. вне фокуса: {{ p.all_posts }} ({{ p.other_names.slice(0, 3).map(x => '@' + x).join(', ') }})</span>
            <span v-else-if="p.found_by" class="chip"><Icon name="search" size="sm"/>{{ p.found_by }}</span><span v-else class="dim">—</span></td>
          <td><Vote v-if="p.role!=='project'" :u="p.username" :vote="p.vote" :reason="p.vote_reason" via="finds"/></td></tr></table></div>
    </div>
  </div>`,
  setup(props) {
    const d = ref(null), tab = ref(props.arg || 'in_focus'), open = reactive({}), nicheSel = ref(null);
    // projects grouped by niche: niches by total placements, projects by placements then followers
    const nicheGroups = computed(() => {
      const m = {};
      (d.value?.in_focus || []).forEach(p => { const k = p.niche || 'без ниши'; (m[k] = m[k] || []).push(p); });
      return Object.entries(m).map(([niche, items]) => ({ niche,
        items: items.sort((a, b) => (b.focus_posts - a.focus_posts) || ((b.followers || 0) - (a.followers || 0))),
        posts: items.reduce((s, p) => s + p.focus_posts, 0) })).sort((a, b) => b.posts - a.posts || b.items.length - a.items.length);
    });
    const load = async () => d.value = await api('/api/finds');
    async function track(p) { await api('/api/accounts', { method: 'POST', body: { usernames: [p.username], role: 'project' } }); toast('@' + p.username + ' отслеживается'); load(); }
    async function contentRun() {
      try { await api('/api/run?kind=content', { method: 'POST' }); toast('Собираю посты проектов и просмотры reels, потом ИИ сделает разборы'); refreshState(); }
      catch (e) { toast(e.message, true); }
    }
    onMounted(load);
    return { d, tab, open, nicheSel, nicheGroups, load, track, contentRun, CATEGORY, st: computed(() => store.st), ...H };
  },
};

const Projects = {
  components: { Who, Spark, Links },
  template: `
  <div>
    <div class="head"><h1>Проекты</h1><span class="sub">{{ list.length }} в анализе</span><span class="sp"></span>
      <input v-model="q" placeholder="Поиск по нику и био" aria-label="Поиск проектов" style="width:200px">
      <select v-model="niche"><option value="">Все ниши</option><option v-for="n in niches" :value="n">{{ n }}</option></select>
      <select v-model="sort"><option value="ads">По рекламам</option><option value="followers">По подписчикам</option><option value="growth">По росту 7д</option><option value="last">По свежести рекламы</option></select></div>
    <div class="cards">
      <div class="card pcard" v-for="p in shown" :key="p.username" @click="go(p.username)">
        <div class="row" style="flex-wrap:nowrap"><Who :u="p.username" :src="p.avatar" :sub="p.full_name"/><span class="sp"></span>
          <span class="chip w" v-if="p.restricted">18+</span></div>
        <div class="row" style="gap:6px"><span class="chip p" v-if="p.niche">{{ p.niche }}</span>
          <span class="chip" v-if="p.persona && p.persona!=='unknown'">{{ p.persona === 'face' ? 'с лицом' : 'faceless' }}</span>
          <span class="chip c" v-if="p.funnel && p.funnel!=='none'">→ {{ p.funnel }}</span></div>
        <Spark :v="p.spark"/>
        <div class="stats3"><div><b>{{ fmt(p.followers) }}</b><span>подписчики</span></div>
          <div><b :style="{color: p.growth_7d > 0 ? 'var(--good)' : p.growth_7d < 0 ? 'var(--bad)' : ''}">{{ signed(p.growth_7d) }}</b><span>за 7 дней</span></div>
          <div><b>{{ p.ads }}</b><span>реклам · {{ p.sources }} площ.</span></div></div>
        <div class="small dim">последняя реклама: {{ p.last_ad ? day(p.last_ad) : '—' }} · скан {{ ago(p.tagged_at) }}</div>
      </div>
    </div>
    <Skel v-if="!loaded" :rows="6"/>
    <div v-else-if="!list.length" class="card"><Empty icon="briefcase" text="Проектов в анализе пока нет — добавь их на странице «Фокус» или прими из «Находок»"/></div>
  </div>`,
  setup() {
    const list = ref([]), q = ref(''), niche = ref(''), sort = ref('ads'), loaded = ref(false);
    onMounted(async () => { list.value = await api('/api/projects'); loaded.value = true; });
    const niches = computed(() => [...new Set(list.value.map(p => p.niche).filter(Boolean))].sort());
    const shown = computed(() => {
      let l = list.value.filter(p => (!niche.value || p.niche === niche.value) &&
        (!q.value || (p.username + ' ' + (p.full_name || '') + ' ' + (p.bio || '')).toLowerCase().includes(q.value.toLowerCase())));
      const key = { ads: p => p.ads, followers: p => p.followers || 0, growth: p => p.growth_7d ?? -1e12, last: p => p.last_ad || 0 }[sort.value];
      return l.sort((a, b) => key(b) - key(a));
    });
    return { list, q, niche, sort, niches, shown, loaded, go: u => location.hash = '#/a/' + u, ...H };
  },
};

// delta helpers for dynamics: {d, h, partial, pct}
const dl = x => !x ? '—' : signed(x.d) + (x.partial ? '*' : '');
const dpct = x => !x || x.pct == null ? '' : (x.pct > 0 ? '+' : '') + x.pct + '%';
const cls = x => !x ? '' : x.d > 0 ? 'up' : x.d < 0 ? 'down' : '';

const Account = {
  components: { Who, Av, Links, Vote, Taste, Teardown },
  props: ['arg'],
  template: `
  <div v-if="d">
    <div class="card" style="margin-bottom:16px">
      <div class="acc-head">
        <Av :u="a.username" :src="a.avatar" size="lg"/>
        <div style="flex:1;min-width:0">
          <div class="row"><h1 style="margin:0;font:600 22px/1.3 var(--mono);color:var(--heading);overflow-wrap:anywhere">@{{ a.username }}</h1>
            <a :href="igUrl(a.username)" target="_blank" rel="noopener" class="btn sm">Instagram<Icon name="external-link" size="sm"/></a>
            <span :class="['chip', ROLE[a.role]?.[1]]">{{ ROLE[a.role]?.[0] || a.role }}</span>
            <span class="chip w" v-if="a.restricted">18+</span><span class="chip c" v-if="a.is_verified"><Icon name="circle-check" size="sm"/>verified</span></div>
          <div class="muted" style="margin:2px 0 8px">{{ a.full_name }}</div>
          <div class="bio" style="max-height:none;color:var(--text)">{{ a.bio }}</div>
          <div style="margin-top:10px"><Links :links="a.links"/></div>
          <div class="row" style="margin-top:10px;gap:6px">
            <span class="chip p" v-if="a.niche">{{ a.niche }}</span>
            <span class="chip" v-if="a.persona && a.persona!=='unknown'">{{ a.persona === 'face' ? 'с лицом' : 'faceless' }}</span>
            <span class="chip c" v-if="a.funnel && a.funnel!=='none'">воронка → {{ a.funnel }}</span>
            <span class="chip" v-for="m in a.matched">{{ m }}</span></div>
          <div class="small muted row" style="margin-top:8px;gap:5px;flex-wrap:nowrap;align-items:flex-start" v-if="a.reason"><Icon name="bot" size="sm" style="margin-top:2px"/><span>{{ a.reason }} <span v-if="a.confidence" class="dim">({{ Math.round(a.confidence*100) }}%)</span></span></div>
          <div class="row" style="margin-top:10px"><span class="small muted">Это проект?</span>
            <Vote :u="a.username" :vote="d.feedback?.label" :reason="d.feedback?.reason" via="account" @voted="load"/><Taste :t="d.taste"/></div>
          <div class="small row" style="margin-top:6px;gap:5px;color:var(--bad)" v-if="a.error"><Icon name="triangle-alert" size="sm"/>{{ a.error }}</div>
        </div>
        <div class="acc-side">
          <div class="stats3"><div><b>{{ fmt(a.followers) }}</b><span>подписчики</span></div>
            <div><b>{{ fmt(a.media_count) }}</b><span>постов</span></div><div><b>{{ d.ads_total }}</b><span>реклам</span></div></div>
          <div class="stats3" v-if="dy">
            <div><b :class="cls(dy.d1)">{{ dl(dy.d1) }}</b><span>за 24 ч</span></div>
            <div><b :class="cls(dy.d7)">{{ dl(dy.d7) }}</b><span>за 7 дней</span></div>
            <div><b>{{ dy.per_day != null ? signed(dy.per_day) : '—' }}</b><span>в день</span></div></div>
          <div class="row">
            <button class="btn good sm" v-if="a.role!=='project'" @click="setRole('project')"><Icon name="plus" size="sm"/>В проекты</button>
            <button class="btn sm" v-if="a.role!=='focus'" @click="setRole('focus')"><Icon name="plus" size="sm"/>В фокус</button>
            <button class="btn sm" v-if="a.role==='project' || a.role==='focus'" @click="setRole('candidate')">Убрать из анализа</button>
            <button class="btn bad sm" v-if="a.role!=='rejected'" @click="setRole('rejected')">Отклонить</button></div>
        </div></div>
    </div>

    <div class="card" style="margin-bottom:16px" v-if="d.teardown"><h3 class="row" style="gap:6px"><Icon name="microscope" size="sm"/>Разбор проекта</h3><Teardown :t="d.teardown"/></div>

    <div class="card" style="margin-bottom:16px"><div class="row" style="margin-bottom:8px"><h3 style="margin:0">Подписчики и размещения</h3><span class="sp"></span>
      <select v-model.number="range" style="width:auto"><option :value="30">30 дней</option><option :value="90">90 дней</option><option :value="180">180 дней</option><option :value="0">вся история</option></select></div>
      <div style="height:280px"><canvas ref="cv"></canvas></div>
      <div class="help" style="margin-top:6px">Линия — подписчики (снимок каждый прогон). Столбики — реклама в день: <b>кликни по столбику</b>, чтобы увидеть посты этого дня. Рост «за окно» считается между снимками до и после размещения{{ d.base_per_hour != null ? ' · обычный темп ' + d.base_per_hour + '/ч' : '' }}.</div>
    </div>

    <div class="grid g2" style="margin-bottom:16px">
      <div class="card"><h3>Откуда шёл трафик · площадки</h3>
        <table v-if="d.sources.length"><tr><th>Площадка</th><th class="num">Реклам</th><th class="num">Аудитория</th><th class="num">Рост после</th><th>Последняя</th></tr>
          <tr v-for="s in d.sources.slice(0, 25)"><td><div class="row" style="flex-wrap:nowrap"><Who :u="s.username" :src="s.avatar" size="sm"/>
            <span v-if="s.satellite" class="chip w" title="Клип/саппорт-аккаунт самого проекта">сателлит</span></div></td><td class="num"><b>{{ s.ads }}</b></td>
            <td class="num">{{ fmt(s.followers) }}</td><td class="num" :style="{color: s.growth > 0 ? 'var(--good)' : ''}">{{ s.measured ? signed(s.growth) : '—' }}</td>
            <td class="small muted">{{ day(s.last) }}</td></tr></table>
        <div v-else class="empty">Упоминаний пока нет</div></div>
      <div class="card"><h3>Кого рекламирует / куда переливает сам</h3>
        <table v-if="d.promotes.length"><tr><th>Аккаунт</th><th></th><th class="num">Постов</th></tr>
          <tr v-for="p in d.promotes"><td><Who :u="p.username" :src="p.avatar" size="sm"/></td>
            <td><span v-if="p.role==='project' || p.kind==='project'" class="chip p">проект</span><span v-else-if="p.role==='focus'" class="chip c">фокус</span></td>
            <td class="num">{{ p.c }}</td></tr></table>
        <div v-else class="empty">Не нашёл упоминаний других аккаунтов в его постах</div></div>
    </div>

    <div class="card" ref="feedCard">
      <div class="row" style="margin-bottom:12px">
        <div class="tabs" style="margin:0">
          <button :class="{on: tab==='ads'}" @click="tab='ads'">Размещения у других · {{ d.ads_total }}</button>
          <button :class="{on: tab==='own'}" @click="tab='own'">Свои посты · {{ d.own_total }}</button></div>
        <button v-if="selDay" class="chip c" style="cursor:pointer;border:0" @click="selDay=null" title="Показать все дни" aria-label="Сбросить выбранный день"><Icon name="calendar" size="sm"/>{{ dayLong(selDay) }} · {{ shown.length }}<Icon name="x" size="sm"/></button>
        <span class="sp"></span>
        <select v-model="dlScope" style="width:auto"><option value="ads">рекламы</option><option value="own">свои посты</option><option value="all">всё</option></select>
        <button class="btn" :disabled="dls?.running" @click="download" :title="'Папка: ' + (st?.download_dir || '') + '/perliv/' + a.username">
          <Icon :name="dls?.running && dls.username === a.username ? 'loader-circle' : 'download'" :spin="dls?.running && dls.username === a.username"/>
          {{ dls?.running && dls.username === a.username ? dls.done + ' / ' + dls.total : 'Скачать' + (selDay ? ' за день' : '') }}</button>
      </div>
      <div v-if="dls && dls.username === a.username && (dls.running || dls.message)" class="small muted" style="margin:-4px 0 12px">
        {{ dls.message }} <a v-if="!dls.running" href="" @click.prevent="openFolder">открыть папку</a> <span class="dim">{{ dls.dir }}</span></div>
      <div class="feed">
        <a v-for="p in shown.slice(0, selDay ? 500 : limit)" :key="p.pk" :href="postUrl(p.code)" target="_blank" :class="['post', {gone: p.deleted_at}]" :title="p.caption">
          <img v-if="p.image && !p._broken" :src="p.image" referrerpolicy="no-referrer" loading="lazy" @error="p._broken = true">
          <div v-else class="ph">{{ (p.caption || '').slice(0, 90) }}</div>
          <span v-if="p.deleted_at" class="chip r gone-chip" :title="'Пропал из Instagram ' + dt(p.deleted_at)">удалён</span>
          <span v-if="p.n_media > 1" class="chip n-media" :title="p.n_media + ' слайдов'"><Icon name="layers" size="sm"/>{{ p.n_media }}</span>
          <div class="cap"><b>@{{ p.owner }}</b><br>{{ dt(p.taken_at) }}<span v-if="p.likes != null"> · {{ fmt(p.likes) }} лайков</span>
            <span v-if="p.growth" :style="{color: p.growth.delta > 0 ? 'var(--good)' : 'var(--bad)'}"> · {{ signed(p.growth.delta) }}</span>
            <span v-if="p.paid" class="chip w" style="margin-left:4px;padding:0 6px">paid</span></div></a>
      </div>
      <Empty v-if="!shown.length" icon="image" :text="selDay ? 'В этот день постов нет' : 'Постов пока нет'"/>
      <div v-if="!selDay && shown.length > limit" style="text-align:center;margin-top:12px"><button class="btn sm" @click="limit += 120">Показать ещё ({{ shown.length - limit }})</button></div>
    </div>
  </div>
  <div v-else-if="err" class="card"><Empty icon="circle-alert" :text="err"/></div>
  <Skel v-else :blocks="3" :rows="8"/>`,
  setup(props) {
    const d = ref(null), err = ref(''), cv = ref(null), feedCard = ref(null);
    const tab = ref('ads'), selDay = ref(null), limit = ref(120), dlScope = ref('ads'), range = ref(90);
    let chart;
    const a = computed(() => d.value?.account || {});
    // local-midnight bucket (seconds) — days on the chart match the dates the user sees
    const dayKey = ts => { const x = new Date(ts * 1000); x.setHours(0, 0, 0, 0); return x.getTime() / 1000; };
    const dayLong = ts => new Date(ts * 1000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
    const shown = computed(() => {
      const l = (tab.value === 'ads' ? d.value?.ads : d.value?.own) || [];
      return selDay.value ? l.filter(p => p.taken_at && dayKey(p.taken_at) === selDay.value) : l;
    });
    async function load() {
      try { d.value = await api('/api/accounts/' + props.arg); } catch (e) { err.value = 'Аккаунт не найден'; return; }
      if (!d.value.ads_total && d.value.own_total) tab.value = 'own';
      dlScope.value = tab.value;
      await nextTick(); draw();
    }
    async function download() {
      const q = new URLSearchParams({ scope: dlScope.value });
      if (selDay.value) { q.set('start', selDay.value); q.set('end', selDay.value + 86400); }
      try { await api(`/api/download/${a.value.username}?${q}`, { method: 'POST' }); toast('Скачиваю в ' + (store.st?.download_dir || 'Загрузки')); refreshState(); }
      catch (e) { toast(e.message, true); }
    }
    const openFolder = () => api('/api/open-folder', { method: 'POST' });
    watch(tab, t => { dlScope.value = t; limit.value = 120; });
    watch(range, () => draw());
    function draw() {
      if (!cv.value) return;
      chart?.destroy();
      const perDay = {};
      d.value.ads.forEach(p => { if (p.taken_at) { const k = dayKey(p.taken_at); perDay[k] = (perDay[k] || 0) + 1; } });
      const snaps = d.value.snapshots;
      const xs = [...Object.keys(perDay).map(Number), ...snaps.map(s => s.ts)];
      const min = range.value ? Math.max(Math.min(...xs), Date.now() / 1000 - range.value * 86400) : Math.min(...xs) - 86400;
      const T = chartTheme();
      chart = new Chart(cv.value, {
        data: {
          datasets: [
            { type: 'bar', label: 'Реклам за день', yAxisID: 'y1', backgroundColor: alpha(T.accent, .75), borderRadius: 3, barThickness: 6,
              data: Object.entries(perDay).map(([k, v]) => ({ x: +k * 1000, y: v })) },
            { type: 'line', label: 'Подписчики', yAxisID: 'y2', borderColor: T.primary, backgroundColor: alpha(T.primary, .1), fill: true,
              tension: .3, pointRadius: 3, data: snaps.map(s => ({ x: s.ts * 1000, y: s.followers })) },
          ],
        },
        options: {
          maintainAspectRatio: false, animation: false, interaction: { mode: 'nearest', intersect: false },
          // Bars are thin: pick the day under the cursor instead of requiring a hit on the bar itself.
          onClick: (evt, _, c) => {
            const k = dayKey(c.scales.x.getValueForPixel(evt.x) / 1000);
            const near = [k, k - 86400, k + 86400].find(x => perDay[x]);
            if (!near) return;
            selDay.value = near; tab.value = 'ads';
            nextTick(() => feedCard.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
          },
          onHover: (evt, _, c) => { const k = dayKey(c.scales.x.getValueForPixel(evt.x) / 1000); evt.native.target.style.cursor = perDay[k] ? 'pointer' : 'default'; },
          plugins: { legend: { labels: { color: T.text, font: { family: 'Fira Sans' } } },
            tooltip: { callbacks: { title: it => it[0].dataset.type === 'bar' ? dayLong(it[0].parsed.x / 1000) + ' — клик: показать посты' : new Date(it[0].parsed.x).toLocaleString('ru-RU') } } },
          scales: {
            x: { type: 'linear', min: min * 1000, ticks: { color: T.dim, callback: v => new Date(v).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) }, grid: { color: T.grid } },
            y1: { position: 'left', beginAtZero: true, title: { display: true, text: 'реклам', color: T.dim }, ticks: { color: T.text, precision: 0 }, grid: { color: T.grid } },
            y2: { position: 'right', title: { display: true, text: 'подписчики', color: T.dim }, ticks: { color: T.primary, callback: v => fmt(v) }, grid: { display: false } },
          },
        },
      });
    }
    async function setRole(role) {
      await api('/api/accounts/' + props.arg, { method: 'PATCH', body: { role, via: 'account' } });
      if (role === 'project' || role === 'focus') await api('/api/accounts', { method: 'POST', body: { usernames: [props.arg], role } });
      toast('Сохранено'); load();
    }
    onMounted(load);
    onUnmounted(() => chart?.destroy());
    watch(() => props.arg, load);
    return { d, a, err, cv, feedCard, tab, selDay, limit, range, shown, dayLong, dlScope, download, openFolder, setRole, load,
      dy: computed(() => d.value?.dynamics), dls: computed(() => store.st?.download), dl, cls, st: computed(() => store.st), ...H };
  },
};

const Candidates = {
  components: { Who, Links, Vote, Taste },
  props: ['arg'],
  template: `
  <div>
    <div class="head"><h1>Кандидаты</h1><span class="sub">все, кого рекламировали в пабликах, у проектов и нашли поиском</span><span class="sp"></span>
      <input v-model="q" placeholder="Поиск по нику, био, нише" aria-label="Поиск кандидатов" @keyup.enter="load" style="width:220px">
      <select v-model="kind" @change="load" aria-label="Фильтр по вердикту"><option value="">Все</option><option value="hot">Перспективные по ИИ (ещё не открыты)</option><option value="project">Похожи на проект</option><option value="unknown">Не ясно</option>
        <option value="unclassified">Не проверены</option><option value="not_project">Не проекты</option><option value="filtered">Вне фильтра (мало подписчиков / регион / язык)</option><option value="affiliate">Клипперы / партнёрки (продают трафик бренду)</option></select>
      <select v-model="src" @change="load" aria-label="Источник"><option value="">Любой источник</option><option value="focus">Из фокус-пабликов</option><option value="search">Из поиска по словам</option></select>
      <select v-model="sort" @change="load" aria-label="Сортировка"><option value="">По упоминаниям</option><option value="new">Свежие сначала</option><option value="triage">По оценке ИИ</option><option value="taste">По моему вкусу</option></select></div>
    <Skel v-if="!qs" :blocks="6" :rows="6"/>
    <div class="kpis" v-if="qs" style="margin-bottom:14px">
      <div class="card kpi"><div class="v">{{ qs.q_total }}</div><div class="l">всего кандидатов</div></div>
      <a class="card kpi" href="" @click.prevent="kind='unclassified'; sort='triage'; load()"><div class="v">{{ qs.q_unopened }}</div><div class="l">в очереди: профиль ещё не открыт · ~{{ s ? s.enrich_per_run : 60 }} за прогон</div></a>
      <a :class="['card', 'kpi', {accent: kind==='hot'}]" href="" @click.prevent="kind='hot'; sort='triage'; load()"><div class="v"><Icon name="flame" size="lg" style="color:var(--accent)"/>{{ qs.q_hot }}</div><div class="l">из очереди ИИ считает проектами — открыть список</div></a>
      <div class="card kpi"><div class="v">{{ qs.q_unclassified }}</div><div class="l">открыты, ждут проверки ИИ</div></div>
      <a class="card kpi accent" href="" @click.prevent="kind='project'; sort=''; load()"><div class="v">{{ qs.q_projects }}</div><div class="l">похожи на проект</div></a>
      <a class="card kpi" href="" @click.prevent="kind='filtered'; sort=''; load()"><div class="v">{{ qs.q_filtered }}</div><div class="l">вне фильтра: &lt;{{ s?.min_followers }} подписч., не US, не en</div></a>
    </div>
    <div class="card row" style="margin-bottom:14px;gap:12px" v-if="qs">
      <div style="flex:1;min-width:260px"><b>Большой разбор очереди</b>
        <div class="small muted">ИИ сортирует всю очередь по подписям постов без Instagram (отсортировано {{ qs.q_triaged }} из {{ qs.q_unopened }}, перспективных {{ qs.q_hot }}),
          потом открывает только {{ s?.bulk_enrich }} лучших профилей и проверяет их. Для большого завала, например после добавления 100 пабликов.</div></div>
      <div class="row" style="gap:8px">
        <button class="btn" :disabled="st?.pipeline.running" @click="runApify" title="Все фокус-паблики и очередь кандидатов через Apify, без сессии Instagram"><Icon name="rocket"/>Быстрый проход (Apify)</button>
        <button class="btn primary" :disabled="st?.pipeline.running" @click="runBulk"><Icon name="rocket"/>Запустить разбор</button></div>
    </div>
    <div class="callout" v-if="kind==='hot'" style="margin-bottom:14px">
      <Icon name="flame" size="lg"/><div><b>Перспективные: ИИ прочитал подписи рекламных постов, профили ещё не открыты</b>
      <div class="small muted" style="margin-top:4px">Био и ссылок пока нет, поэтому вердикт предварительный. Что можно сделать:
        <b>Отслеживать</b> — если по нику и подписи уже ясно, что это проект; «не проект» или «убрать» — если нет, это учит ИИ;
        или ничего: следующий прогон или «Запустить разбор» откроет их профили, начиная с самых высоких процентов, и ИИ вынесет точный вердикт.</div></div>
    </div>
    <div class="help" style="margin:-4px 0 14px">Оценки «проект / не проект» учат систему: веса признаков пересчитываются сразу, а следующий прогон ИИ получает твои оценки как примеры. Подробности на странице «Признаки».</div>
    <div class="card" v-if="qs">
      <table><tr><th>Аккаунт</th><th>Вердикт</th><th>Описание</th><th class="num">Упом.</th><th>Откуда</th><th>Оценка</th><th></th></tr>
        <tr v-for="c in rows" :key="c.username">
          <td style="max-width:230px"><Who :u="c.username" :src="c.avatar" :sub="fmt(c.followers) + ' · ' + (c.full_name || '')"/></td>
          <td style="white-space:nowrap"><span v-if="c.kind" :class="['chip', KIND[c.kind]?.[1]]">{{ KIND[c.kind]?.[0] }}</span>
            <span v-else class="chip">{{ c.profile_at ? 'ждёт ИИ' : 'не открыт' }}</span>
            <div class="small" v-if="c.kind==='filtered'" style="margin-top:4px;color:var(--warn)">{{ c.filter_reason }}</div>
            <div class="small dim" v-if="c.niche" style="margin-top:4px">{{ c.niche }}</div>
            <div class="row" style="gap:4px;margin-top:4px" v-if="c.lang || c.region"><span class="chip" v-if="c.region && REGION[c.region]">{{ REGION[c.region] }}</span><span class="chip" v-if="c.lang && c.lang !== 'unknown'">{{ c.lang }}</span></div>
            <div v-if="!c.profile_at && c.triage != null" style="margin-top:6px;white-space:normal;max-width:200px" title="Оценка ИИ по подписям постов, профиль ещё не открыт">
              <span :class="['chip', c.triage >= 0.5 ? 'g' : c.triage < 0.15 ? '' : 'w']"><Icon name="flame" size="sm"/>ИИ: {{ Math.round(c.triage * 100) }}%</span>
              <div class="small dim" style="margin-top:3px">{{ c.triage_note }}</div></div>
            <div style="margin-top:4px"><Taste :t="c.taste"/></div></td>
          <td style="max-width:360px"><div class="bio" v-if="c.bio">{{ c.bio }}</div>
            <div v-else-if="c.ad_caption" class="small"><span class="dim">Профиль не открыт. Упомянут в посте:</span><div class="bio" style="margin-top:3px">{{ c.ad_caption }}</div></div>
            <div v-else-if="c.own_caption" class="small"><span class="dim">Профиль не открыт. Его пост из поиска:</span><div class="bio" style="margin-top:3px">{{ c.own_caption }}</div></div><div class="small muted row" v-if="c.reason" style="margin-top:4px;gap:5px;flex-wrap:nowrap;align-items:flex-start"><Icon name="bot" size="sm" style="margin-top:2px"/><span>{{ c.reason }}</span></div><Links :links="c.links" style="margin-top:4px"/></td>
          <td class="num">{{ c.mentions }}</td>
          <td class="small" style="max-width:190px"><a v-for="p in c.promoted_by" :key="p" :href="'#/a/' + p" class="muted" style="margin-right:6px">@{{ p }}</a>
            <span v-if="c.found_by" class="chip" title="Найден поиском по ключевому слову"><Icon name="search" size="sm"/>{{ c.found_by.split(',')[0] }}</span></td>
          <td><Vote :u="c.username" :vote="c.vote" :reason="c.vote_reason" via="candidates" @voted="v => c.vote = v"/></td>
          <td style="white-space:nowrap"><button class="btn good sm" @click="role(c, 'project')">Отслеживать</button>
            <button class="btn sm" @click="role(c, 'focus')" title="Это площадка — анализировать её рекламу">В фокус</button>
            <button class="btn sm icon" @click="role(c, 'rejected')" title="Убрать и засчитать как «не проект»" :aria-label="'Отклонить @' + c.username"><Icon name="x"/></button></td></tr></table>
      <Empty v-if="!rows.length" icon="users" text="Под этот фильтр кандидатов нет — смени фильтр или источник выше"/>
    </div>
  </div>`,
  setup(props) {
    const rows = ref([]), kind = ref(props.arg || ''), q = ref(''), src = ref(''), sort = ref(props.arg === 'hot' ? 'triage' : ''), qs = ref(null), s = ref(null);
    const load = async () => {
      rows.value = await api(`/api/candidates?kind=${kind.value}&sort=${sort.value}&src=${src.value}&q=${encodeURIComponent(q.value)}`);
      qs.value = await api('/api/queue');
    };
    api('/api/settings').then(x => s.value = x);
    async function role(c, r) {
      if (r === 'rejected') await api('/api/accounts/' + c.username, { method: 'PATCH', body: { role: r, via: 'candidates' } });
      else await api('/api/accounts', { method: 'POST', body: { usernames: [c.username], role: r } });
      rows.value = rows.value.filter(x => x !== c);
      toast('@' + c.username + (r === 'rejected' ? ' отклонён' : r === 'project' ? ' добавлен в проекты' : ' добавлен в фокус'));
    }
    onMounted(load);
    return { rows, kind, q, sort, src, qs, s, load, role, st: computed(() => store.st), ...H };
  },
};

const Niches = {
  template: `
  <div>
    <div class="head"><h1>Ниши</h1><span class="sub">проекты по нишам: сначала те, кто рекламировался в фокус-пабликах</span><span class="sp"></span>
      <input v-model="q" placeholder="Поиск по нику, био, нише" aria-label="Поиск" style="width:210px">
      <select v-model="size" aria-label="Фильтр по подписчикам"><option value="">Любое число подписчиков</option><option value="big">Больше 100K подписчиков</option><option value="small">Меньше 100K подписчиков</option></select>
      <label class="small row" style="gap:6px"><input type="checkbox" v-model="showOther"> показывать без размещений</label></div>
    <Skel v-if="!board" :rows="8"/>
    <div v-else-if="!groups.length" class="card"><Empty icon="layers" text="Под этот фильтр проектов нет"/></div>
    <div v-for="G in groups" :key="G.name" class="card" style="margin-bottom:14px">
      <div class="row" style="align-items:flex-start;gap:10px;cursor:pointer" @click="open[G.name] = !isOpen(G)" :aria-expanded="isOpen(G)">
        <Icon :name="isOpen(G) ? 'chevron-down' : 'chevron-right'" style="margin-top:3px"/>
        <div style="flex:1;min-width:0">
          <div class="row" style="gap:8px"><h2 style="margin:0;font:600 17px/1.3 var(--mono);color:var(--heading);text-transform:capitalize">{{ G.name }}</h2>
            <span class="chip g" v-if="G.placedF.length"><Icon name="target" size="sm"/>{{ G.placedF.length }} в фокусе · {{ G.placements }} разм.</span>
            <span class="chip" v-if="G.otherF.length">{{ G.otherF.length }} без размещений</span></div>
          <div class="small muted" style="margin-top:4px" v-if="G.description">{{ G.description }}</div>
          <div class="row" style="gap:5px;margin-top:6px" v-if="G.subniches.length"><span class="chip p" v-for="sn in G.subniches.slice(0, 8)" :key="sn[0]">{{ sn[0] }} · {{ sn[1] }}</span></div>
        </div></div>
      <template v-if="isOpen(G)">
        <div v-if="G.venues.length" class="small" style="margin:10px 0 0 26px"><span class="dim">Где покупают рекламу:</span>
          <a v-for="v in G.venues" :key="v[0]" :href="'#/a/' + v[0]" class="chip c" style="margin:0 4px 4px 0">@{{ v[0] }} · {{ v[1] }}</a></div>
        <div style="margin:12px 0 0 26px">
          <div class="lg-title row" style="gap:6px"><Icon name="target" size="sm"/>Размещались в фокус-пабликах · {{ G.placedF.length }}</div>
          <div class="tbl" v-if="G.placedF.length"><table><tr><th>Проект</th><th class="num">Подписчики</th><th>Размещения</th><th>Воронка</th><th>Оценка</th></tr>
            <tr v-for="p in G.placedF" :key="p.username">
              <td style="max-width:300px"><Who :u="p.username" :src="p.avatar" :sub="[p.niche, p.full_name].filter(Boolean).join(' · ')"/><div class="bio" style="margin-top:4px">{{ p.bio }}</div></td>
              <td class="num"><b>{{ fmt(p.followers) }}</b></td>
              <td class="small"><b>{{ p.focus_posts }}</b> в {{ p.focus_publics }}:
                <a v-for="f in p.focus_names.slice(0, 4)" :key="f" :href="'#/a/' + f" class="muted" style="margin-right:5px">@{{ f }}</a></td>
              <td><span class="chip c" v-if="p.funnel && p.funnel!=='none'">{{ p.funnel }}</span></td>
              <td><Vote v-if="p.role!=='project'" :u="p.username" :vote="p.vote" via="niches" @voted="v => v === -1 && load()"/><span v-else class="chip p">отслеживается</span></td></tr></table></div>
          <div v-else class="small dim" style="margin:4px 0 8px">Нет</div>
          <template v-if="showOther">
            <div class="lg-title row" style="gap:6px;margin-top:14px"><Icon name="search" size="sm"/>Не размещались в фокусе · {{ G.otherF.length }}</div>
            <div class="tbl" v-if="G.otherF.length"><table><tr><th>Проект</th><th class="num">Подписчики</th><th>Откуда</th><th>Воронка</th><th>Оценка</th></tr>
              <tr v-for="p in G.otherF.slice(0, limit[G.name] || 25)" :key="p.username">
                <td style="max-width:300px"><Who :u="p.username" :src="p.avatar" :sub="[p.niche, p.full_name].filter(Boolean).join(' · ')"/><div class="bio" style="margin-top:4px">{{ p.bio }}</div></td>
                <td class="num"><b>{{ fmt(p.followers) }}</b></td>
                <td class="small"><span v-if="p.other_names.length" class="muted">реклама вне фокуса: {{ p.other_names.slice(0, 3).map(x => '@' + x).join(', ') }}</span>
                  <span v-else-if="p.found_by" class="chip"><Icon name="search" size="sm"/>{{ p.found_by }}</span><span v-else class="dim">—</span></td>
                <td><span class="chip c" v-if="p.funnel && p.funnel!=='none'">{{ p.funnel }}</span></td>
                <td><Vote v-if="p.role!=='project'" :u="p.username" :vote="p.vote" via="niches" @voted="v => v === -1 && load()"/></td></tr></table>
              <div v-if="G.otherF.length > (limit[G.name] || 25)" style="text-align:center;margin-top:8px"><button class="btn sm" @click="limit[G.name] = (limit[G.name] || 25) + 50">Показать ещё ({{ G.otherF.length - (limit[G.name] || 25) }})</button></div></div>
            <div v-else class="small dim">Нет</div>
          </template>
        </div>
      </template>
    </div>

    <details class="card" style="margin-top:16px"><summary style="cursor:pointer;font-weight:600">Добавить нишу вручную</summary>
      <div class="row" style="align-items:flex-end;margin-top:12px">
        <label class="f" style="width:200px">Новая ниша<input v-model="nf.name" placeholder="напр. credit repair"></label>
        <label class="f" style="flex:1;min-width:220px">Поисковые запросы (через запятую, необяз.)<input v-model="nf.keywords" placeholder="credit repair, fix your credit" @keyup.enter="addNiche"></label>
        <label class="f" style="flex:1;min-width:180px">Заметка<input v-model="nf.note" placeholder="откуда идея"></label>
        <button class="btn primary" @click="addNiche" :disabled="!nf.name.trim()"><Icon name="plus"/>Добавить</button></div>
      <div class="help" style="margin-top:8px">Запросы ниши попадут в поиск по словам в следующих прогонах. Новые ниши ИИ сам разложит по группам.</div>
    </details>
  </div>`,
  components: { Who, Vote },
  setup() {
    const board = ref(null), nf = reactive({ name: '', keywords: '', note: '' });
    const q = ref(''), size = ref(''), showOther = ref(true), open = reactive({}), limit = reactive({});
    const load = async () => { board.value = await api('/api/niche-board'); };
    const pass = p => (!size.value || (size.value === 'big' ? (p.followers || 0) >= 1e5 : (p.followers || 0) < 1e5)) &&
      (!q.value || (p.username + ' ' + (p.bio || '') + ' ' + (p.niche || '') + ' ' + (p.full_name || '')).toLowerCase().includes(q.value.toLowerCase()));
    const groups = computed(() => (board.value || []).map(G => ({ ...G, placedF: G.placed.filter(pass), otherF: G.other.filter(pass) }))
      .filter(G => G.placedF.length || (showOther.value && G.otherF.length)));
    // groups with focus placements open by default; the rest on click
    const isOpen = G => open[G.name] ?? G.placedF.length > 0;
    async function addNiche() {
      try { await api('/api/niches', { method: 'POST', body: { ...nf } }); toast('Ниша добавлена'); nf.name = nf.keywords = nf.note = ''; load(); }
      catch (e) { toast(e.message, true); }
    }
    onMounted(load);
    return { board, groups, nf, q, size, showOther, open, limit, isOpen, load, addNiche, ...H };
  },
};

// Graph palette: one meaning per colour, used both in cytoscape styles and in the legend; read from theme tokens.
const graphColors = () => ({ focus: css('--info'), project: css('--primary'), found: css('--violet'), shared: css('--accent'),
  other: css('--dim'), ad: css('--line2'), cross: css('--violet'), co: css('--accent'), sat: css('--line2'),
  text: css('--text'), bg: css('--card'), sel: css('--heading') });
const Graph = {
  template: `
  <div>
    <div class="head"><h1>Граф переливов</h1><span class="sub">кто кого рекламирует и какие проекты покупают рекламу в одних местах</span><span class="sp"></span>
      <label class="small row" style="gap:6px"><input type="checkbox" v-model="opt.co"> связи «общая площадка»</label>
      <label class="small row" style="gap:6px"><input type="checkbox" v-model="opt.onlyShared"> только общие площадки</label>
      <label class="small row" style="gap:6px"><input type="checkbox" v-model="opt.hideSat"> скрыть сателлиты</label></div>
    <div class="graph-wrap">
      <div id="cy"></div>
      <div class="card gpanel" v-if="sel">
        <div class="row"><b>@{{ sel.username }}</b><span class="sp"></span><a class="btn sm" :href="'#/a/' + sel.username">Карточка<Icon name="arrow-right" size="sm"/></a>
          <button class="btn sm icon ghost" @click="sel = null" aria-label="Закрыть панель"><Icon name="x"/></button></div>
        <div class="small muted" style="margin:4px 0 8px">{{ nodeTitle(sel) }} · {{ fmt(sel.followers) }} подписчиков<span v-if="sel.niche"> · {{ sel.niche }}</span></div>
        <div v-if="sel.shared.length" class="small"><b style="color:var(--accent)">Общая площадка</b>: здесь рекламировались {{ sel.shared.length }} разных проекта(ов):
          <div class="row" style="gap:4px;margin-top:4px"><a v-for="p in sel.shared" :href="'#/a/' + p" class="chip p">@{{ p }}</a></div></div>
        <div v-if="coOf(sel.username).length" class="small" style="margin-top:8px"><b style="color:var(--accent)">Покупает там же, где</b>:
          <div v-for="c in coOf(sel.username)" style="margin-top:3px"><a :href="'#/a/' + c.other">@{{ c.other }}</a>
            <span class="dim"> — {{ c.w }} общ. площадк{{ c.w === 1 ? 'а' : 'и' }}: {{ c.via.map(v => '@' + v).join(', ') }}</span></div></div>
        <div v-if="sel.satellite_of" class="small" style="margin-top:8px">Сателлит проекта @{{ sel.satellite_of }} (его клип/саппорт-аккаунт)</div>
      </div>
    </div>
    <div class="row small muted" style="margin:8px 0 16px" v-if="g">Узлов {{ g.nodes.length }}, связей рекламы {{ g.edges.length }} ·
      <b style="color:var(--accent)">{{ g.stats.shared_venues }}</b> общих площадок · <b style="color:var(--accent)">{{ g.stats.co_pairs }}</b> пар проектов с общими площадками</div>

    <div class="card legend-card">
      <h3>Как читать граф</h3>
      <div class="grid g2">
        <div>
          <div class="lg-title">Узлы (аккаунты)</div>
          <div class="lg"><span class="dot" :style="{background: GC.focus}"></span><div><b>Фокус-паблик</b> — из твоего списка «Фокус». Отсюда мы берём рекламу.</div></div>
          <div class="lg"><span class="dot" :style="{background: GC.project}"></span><div><b>Проект в анализе</b> — ты его отслеживаешь: рост, площадки, упоминания.</div></div>
          <div class="lg"><span class="dot" :style="{background: GC.found}"></span><div><b>Найденный проект</b> — ИИ или твоя оценка считает его проектом, но в анализ он ещё не добавлен.</div></div>
          <div class="lg"><span class="dot" :style="{background: GC.shared}"></span><div><b>Общая площадка</b> — паблик (не из фокуса), где рекламировались <b>2 и более разных проекта</b>. Фокус-паблик с той же ролью остаётся своего цвета, но получает <b style="color:var(--accent)">янтарную обводку</b>. Это лучшие кандидаты в «Фокус»: там покупает реклама ниши.</div></div>
          <div class="lg"><span class="dot" :style="{background: GC.other}"></span><div><b>Прочие</b> — кого рекламируют фокус-паблики, но кто пока не похож на проект.</div></div>
          <div class="lg"><span class="dot" :style="{background: GC.other, borderRadius: '2px', transform: 'rotate(45deg)'}"></span><div><b>Ромб — сателлит</b>: клип-, саппорт- или архивный аккаунт самого проекта (kingcapsupport → kingcap702). Это не покупка рекламы.</div></div>
          <div class="lg"><span class="dot" style="background:transparent;border:1px solid var(--muted)"></span><div><b>Размер</b> — аудитория (логарифм числа подписчиков).</div></div>
        </div>
        <div>
          <div class="lg-title">Связи</div>
          <div class="lg"><span class="ln" :style="{background: GC.ad}"></span><div><b>Светлая серая стрелка</b>: площадка → кого рекламирует. Пост с отметкой, соавторством, спонсорской меткой или @ в подписи. <b>Толщина</b> — число таких постов.</div></div>
          <div class="lg"><span class="ln" :style="{background: GC.shared}"></span><div><b>Янтарная стрелка</b>: реклама проекта на общей площадке. По ней видно, какие проекты стоят в одном рекламном «пуле».</div></div>
          <div class="lg"><span class="ln dash" :style="{borderColor: GC.co}"></span><div><b>Янтарный пунктир без стрелки</b>: <b>проект ↔ проект</b>, у которых есть хотя бы одна общая площадка. Цифра — сколько общих площадок. Напрямую они друг друга не рекламировали: связь значит, что они покупают одну и ту же аудиторию (конкуренты или один владелец).</div></div>
          <div class="lg"><span class="ln" :style="{background: GC.cross}"></span><div><b>Фиолетовая стрелка</b>: проект рекламирует другой проект напрямую (кросс-промо, перелив между своими).</div></div>
          <div class="lg"><span class="ln" :style="{background: GC.sat}"></span><div><b>Тонкая тёмная</b>: сателлит → свой проект.</div></div>
          <div class="lg-title" style="margin-top:12px">Управление</div>
          <div class="small muted">Наведи на узел — подсветятся его связи. Клик — панель справа: где он покупал, с кем делит площадки. Двойной клик — карточка аккаунта. Колесо — масштаб, перетаскивание — перемещение. Галочки сверху: убрать пунктир, оставить только общие площадки с их проектами, скрыть сателлиты.</div>
        </div>
      </div>
    </div>
  </div>`,
  setup() {
    let cy;
    const g = ref(null), sel = ref(null), opt = reactive({ co: true, onlyShared: false, hideSat: true }), GC = reactive(graphColors());
    const nodeTitle = n => n.role === 'focus' ? 'фокус-паблик' + (n.shared.length ? ', общая площадка' : '') : n.role === 'project' ? 'проект в анализе'
      : n.project ? 'найденный проект' : n.shared.length ? 'общая площадка' : n.satellite_of ? 'сателлит' : 'аккаунт';
    const coOf = u => (g.value?.co || []).filter(c => c.a === u || c.b === u).map(c => ({ ...c, other: c.a === u ? c.b : c.a })).slice(0, 12);
    function build() {
      cy?.destroy();
      const data = g.value;
      let nodes = data.nodes, edges = data.edges;
      if (opt.hideSat) { nodes = nodes.filter(n => !n.satellite_of || n.project); edges = edges.filter(e => e.type !== 'sat'); }
      if (opt.onlyShared) {
        const keep = new Set();
        nodes.forEach(n => { if (n.shared.length) { keep.add(n.username); n.shared.forEach(p => keep.add(p)); } });
        nodes = nodes.filter(n => keep.has(n.username));
      }
      const ids = new Set(nodes.map(n => n.username));
      const col = n => n.role === 'focus' ? GC.focus : n.role === 'project' ? GC.project : n.project ? GC.found : n.shared.length ? GC.shared : GC.other;
      const size = n => 14 + Math.min(40, Math.log10((n.followers || 1000)) * 5);
      const ecol = { ad: GC.ad, shared: GC.shared, cross: GC.cross, sat: GC.sat };
      cy = cytoscape({
        container: document.getElementById('cy'),
        elements: [
          ...nodes.map(n => ({ data: { id: n.username, label: n.username, color: col(n), size: size(n),
            ring: n.shared.length && n.role === 'focus' ? 3 : 0, shape: n.satellite_of && !n.project ? 'diamond' : 'ellipse' } })),
          ...edges.filter(e => ids.has(e.src) && ids.has(e.dst))
            .map(e => ({ data: { id: e.src + '>' + e.dst, source: e.src, target: e.dst, w: Math.min(8, 1 + Math.log2(e.w)), c: ecol[e.type],
              op: e.type === 'ad' ? .6 : .9 } })),
          ...(opt.co ? data.co.filter(c => ids.has(c.a) && ids.has(c.b)).map(c => ({ classes: 'co',
            data: { id: c.a + '~' + c.b, source: c.a, target: c.b, w: Math.min(6, 1 + c.w), label: String(c.w), c: GC.co, op: .75 } })) : []),
        ],
        style: [
          { selector: 'node', style: { 'background-color': 'data(color)', width: 'data(size)', height: 'data(size)', label: 'data(label)', shape: 'data(shape)',
              'border-width': 'data(ring)', 'border-color': GC.shared, 'font-family': 'Fira Sans',
              color: GC.text, 'font-size': 10, 'text-valign': 'bottom', 'text-margin-y': 4, 'text-outline-color': GC.bg, 'text-outline-width': 2 } },
          { selector: 'edge', style: { width: 'data(w)', 'line-color': 'data(c)', 'target-arrow-color': 'data(c)', 'target-arrow-shape': 'triangle',
              'curve-style': 'bezier', 'arrow-scale': .8, opacity: 'data(op)' } },
          { selector: 'edge.co', style: { 'line-style': 'dashed', 'line-dash-pattern': [6, 4], 'target-arrow-shape': 'none',
              label: 'data(label)', 'font-size': 10, color: GC.co, 'text-background-color': GC.bg, 'text-background-opacity': 1, 'text-background-padding': 2 } },
          { selector: 'node:selected', style: { 'border-width': 3, 'border-color': GC.sel } },
        ],
        layout: { name: 'cose', animate: false, nodeRepulsion: 9000, idealEdgeLength: 90, padding: 30 },
      });
      const byId = Object.fromEntries(data.nodes.map(n => [n.username, n]));
      cy.on('tap', 'node', e => sel.value = byId[e.target.id()]);
      cy.on('dbltap', 'node', e => location.hash = '#/a/' + e.target.id());
      cy.on('tap', e => { if (e.target === cy) sel.value = null; });
      cy.on('mouseover', 'node', e => { cy.elements().style('opacity', .12); e.target.closedNeighborhood().style('opacity', 1); });
      cy.on('mouseout', 'node', () => cy.elements().removeStyle('opacity'));
    }
    onMounted(async () => { g.value = await api('/api/graph'); await nextTick(); build(); });
    watch(opt, build);
    onUnmounted(() => cy?.destroy());
    return { g, sel, opt, GC, nodeTitle, coOf, fmt };
  },
};

const Dynamics = {
  components: { Who, Spark },
  template: `
  <div>
    <div class="head"><h1>Динамика подписчиков</h1><span class="sub">снимок при каждом анализе и лёгкие снимки между ними</span><span class="sp"></span>
      <select v-model="filter"><option value="project">Проекты</option><option value="found">Найденные проекты</option><option value="focus">Фокус-паблики</option><option value="">Все</option></select>
      <button class="btn" :disabled="st?.pipeline.running" @click="snap"><Icon name="camera"/>Снять сейчас</button></div>
    <div class="card" style="margin-bottom:16px"><h3>Рост, % от стартовой точки</h3>
      <div style="height:300px"><canvas ref="cv"></canvas></div>
      <div class="help" style="margin-top:6px">Отметь аккаунты в таблице, чтобы сравнить. Следующий снимок: {{ dt(st?.schedule.next_snapshot) }}. История копится с момента, когда аккаунт попал в базу: прошлую динамику Instagram не отдаёт.</div></div>
    <div class="card">
      <table><tr><th></th><th>Аккаунт</th><th>Ниша</th><th class="num">Сейчас</th><th class="num">24 ч</th><th class="num">7 дней</th><th class="num">30 дней</th>
        <th class="num">В день</th><th class="num">Реклам 7д</th><th class="num" title="Прирост за 7 дней / число реклам">На 1 рекламу</th><th>Тренд</th></tr>
        <tr v-for="r in shown" :key="r.username">
          <td><input type="checkbox" :checked="sel.includes(r.username)" @change="toggle(r.username)"></td>
          <td><Who :u="r.username" :src="r.avatar" size="sm" :sub="r.snaps + ' снимков с ' + day(r.first)"/></td>
          <td><span class="chip p" v-if="r.niche">{{ r.niche }}</span></td>
          <td class="num"><b>{{ fmt(r.followers) }}</b></td>
          <td class="num" :class="cls(r.d1)">{{ dl(r.d1) }}<div class="dim small">{{ dpct(r.d1) }}</div></td>
          <td class="num" :class="cls(r.d7)">{{ dl(r.d7) }}<div class="dim small">{{ dpct(r.d7) }}</div></td>
          <td class="num" :class="cls(r.d30)">{{ dl(r.d30) }}<div class="dim small">{{ dpct(r.d30) }}</div></td>
          <td class="num">{{ r.per_day != null ? signed(r.per_day) : '—' }}</td>
          <td class="num">{{ r.ads7 || '' }}</td><td class="num">{{ r.per_ad != null ? signed(r.per_ad) : '' }}</td>
          <td style="width:120px"><Spark :v="r.series.map(s => s[1])"/></td></tr></table>
      <Empty v-if="!shown.length" icon="trending-up" text="Снимков пока нет — они появятся после анализа или по кнопке «Снять сейчас»"/>
      <div class="help" style="margin-top:8px">* — данных меньше, чем период: показан прирост за всё время наблюдения.</div>
    </div>
  </div>`,
  setup() {
    const rows = ref([]), filter = ref('project'), sel = ref([]), cv = ref(null);
    let chart;
    const shown = computed(() => rows.value.filter(r => !filter.value || (filter.value === 'found' ? r.role !== 'project' && r.kind === 'project' : r.role === filter.value)));
    // series differ by colour AND line style (skill: never by hue alone)
    const DASH = [[], [6, 4], [2, 3], [10, 3, 2, 3]];
    function draw() {
      chart?.destroy();
      if (!cv.value) return;
      const T = chartTheme();
      const ds = rows.value.filter(r => sel.value.includes(r.username)).map((r, i) => {
        const base = r.series[0][1] || 1, c = T.series[i % T.series.length];
        return { label: '@' + r.username, borderColor: c, backgroundColor: c, borderDash: DASH[Math.floor(i / 2) % DASH.length], tension: .3, pointRadius: 2,
          data: r.series.map(s => ({ x: s[0] * 1000, y: +((s[1] - base) / base * 100).toFixed(3) })) };
      });
      chart = new Chart(cv.value, { type: 'line', data: { datasets: ds }, options: {
        maintainAspectRatio: false, animation: false, plugins: { legend: { labels: { color: T.text, font: { family: 'Fira Sans' } } } },
        scales: { x: { type: 'linear', ticks: { color: T.dim, callback: v => new Date(v).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit' }) }, grid: { color: T.grid } },
                  y: { ticks: { color: T.text, callback: v => v + '%' }, grid: { color: T.grid } } } } });
    }
    async function load() {
      rows.value = await api('/api/dynamics');
      if (!sel.value.length) sel.value = shown.value.slice(0, 5).map(r => r.username);
      await nextTick(); draw();
    }
    function toggle(u) { sel.value = sel.value.includes(u) ? sel.value.filter(x => x !== u) : [...sel.value, u]; draw(); }
    async function snap() { try { await api('/api/run?kind=snapshot', { method: 'POST' }); toast('Снимаю подписчиков проектов…'); } catch (e) { toast(e.message, true); } }
    watch(filter, () => { sel.value = shown.value.slice(0, 5).map(r => r.username); draw(); });
    watch(() => store.st?.pipeline.running, (v, old) => { if (old && !v) load(); });
    onMounted(load);
    onUnmounted(() => chart?.destroy());
    return { rows, filter, sel, cv, shown, toggle, snap, dl, dpct, cls, st: computed(() => store.st), ...H };
  },
};

const Explore = {
  template: `
  <div>
    <div class="head"><h1>Новые ниши</h1><span class="sub">как система находит то, чего ещё нет в фокусе</span><span class="sp"></span>
      <button class="btn primary" @click="ideas" :disabled="busy"><Icon :name="busy ? 'loader-circle' : 'sparkles'" :spin="busy"/>{{ busy ? 'Думаю…' : 'Предложить ниши (ИИ)' }}</button></div>
    <div class="grid g2" style="margin-bottom:16px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">
      <div class="card"><b>1. Фокус-паблики</b><div class="small muted">Всё, что рекламируют паблики, проверяется ИИ. Проект из незнакомой ниши сразу создаёт новую нишу.</div></div>
      <div class="card"><b>2. Разведка площадок</b><div class="small muted">Паблики, рекламирующие наши проекты, рекламируют и чужие. Каждый прогон смотрю ленты {{ s?.explore_sources_per_run }} таких площадок и найденных проектов: проекты рекламируют друг друга.</div></div>
      <div class="card"><b>3. Поиск по словам</b><div class="small muted">Каждый прогон ищу в Instagram {{ s?.keywords_per_run }} запроса из списка ниже. Авторы постов становятся кандидатами.</div></div>
      <div class="card"><b>4. ИИ-идеи</b><div class="small muted">Раз в день ИИ смотрит на найденные ниши и твои оценки, предлагает соседние ниши и запросы для поиска. Они сами попадают в список.</div></div>
    </div>

    <div class="split">
      <div class="card"><h3>Поисковые запросы</h3>
        <div class="row" style="margin-bottom:12px"><input v-model="kw" placeholder="напр. forex mentor, credit repair (через запятую)" style="flex:1" @keyup.enter="add">
          <input v-model="kwNiche" placeholder="ниша (необяз.)" aria-label="Ниша запроса" style="width:150px"><button class="btn primary" @click="add" :disabled="!kw.trim()"><Icon name="plus"/>Добавить</button></div>
        <table><tr><th>Вкл</th><th>Запрос</th><th>Ниша</th><th class="num">Авторов</th><th class="num">Проектов</th><th>Последний поиск</th><th></th></tr>
          <tr v-for="k in data?.keywords || []" :key="k.id" :style="{opacity: k.enabled ? 1 : .5}">
            <td><input type="checkbox" :checked="k.enabled" @change="toggle(k, $event.target.checked)"></td>
            <td><b>{{ k.text }}</b> <span v-if="k.source==='ai'" class="chip p" style="padding:0 6px">ИИ</span></td>
            <td class="small muted">{{ k.niche }}</td><td class="num">{{ k.hits }}</td>
            <td class="num"><b :style="{color: k.projects ? 'var(--good)' : ''}">{{ k.projects || 0 }}</b><div class="dim small" v-if="k.niches">{{ k.niches }}</div></td>
            <td class="small muted">{{ k.last_run ? ago(k.last_run) : 'в очереди' }}</td>
            <td><button class="btn sm icon ghost" @click="del(k)" :aria-label="'Удалить запрос ' + k.text" title="Удалить запрос"><Icon name="trash-2"/></button></td></tr></table>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div class="card"><h3>Ниши по свежести</h3>
          <div v-for="n in data?.niches || []" style="padding:8px 0;border-bottom:1px solid var(--line)">
            <div class="row"><b style="text-transform:capitalize">{{ n.niche }}</b><span class="chip">{{ n.n }}</span><span class="sp"></span>
              <span class="small dim" :title="ago(n.first)">{{ dtFull(n.first) }}<span v-if="n.source_title"> · {{ n.source_title }}</span></span></div>
            <div class="row" style="gap:5px;margin-top:4px"><a v-for="m in n.members" :href="'#/a/' + m" class="chip p">@{{ m }}</a>
              <span v-for="v in n.via" :key="v" class="chip"><Icon name="search" size="sm"/>{{ v }}</span></div></div>
          <div v-if="!data?.niches.length" class="empty">Пока нет</div></div>
        <div class="card" v-if="data?.ideas?.length"><h3>Последние идеи ИИ</h3>
          <div v-for="i in data.ideas" style="padding:6px 0"><b style="text-transform:capitalize">{{ i.niche }}</b> <span class="small muted">— {{ i.why }}</span>
            <div class="row" style="gap:5px;margin-top:3px"><span class="chip c" v-for="k in i.keywords">{{ k }}</span></div></div></div>
      </div>
    </div>
  </div>`,
  setup() {
    const data = ref(null), s = ref(null), kw = ref(''), kwNiche = ref(''), busy = ref(false);
    const load = async () => { data.value = await api('/api/explore'); };
    async function add() { await api('/api/keywords', { method: 'POST', body: { text: kw.value, niche: kwNiche.value } }); kw.value = ''; load(); toast('Запрос добавлен: будет в следующих прогонах'); }
    async function toggle(k, v) { await api('/api/keywords/' + k.id, { method: 'PATCH', body: { enabled: v } }); k.enabled = v; }
    async function del(k) { await api('/api/keywords/' + k.id, { method: 'DELETE' }); load(); }
    async function ideas() {
      busy.value = true;
      try { const r = await api('/api/niche-ideas', { method: 'POST' }); toast(`ИИ предложил ${r.ideas.length} ниш, новых запросов: ${r.added}`); load(); }
      catch (e) { toast(e.message, true); } finally { busy.value = false; }
    }
    onMounted(async () => { load(); s.value = await api('/api/settings'); });
    return { data, s, kw, kwNiche, busy, add, toggle, del, ideas, dtFull, ...H };
  },
};

const Signals = {
  template: `
  <div>
    <div class="head"><h1>Признаки проекта</h1><span class="sub">ручные + выученные из твоих оценок</span></div>
    <Skel v-if="!L" :rows="6"/>
    <div class="card" style="margin-bottom:16px" v-if="L">
      <h3 class="row" style="gap:8px">Выучено из твоих оценок <span class="chip g"><Icon name="thumbs-up" size="sm"/>{{ L.pos }}</span><span class="chip r"><Icon name="thumbs-down" size="sm"/>{{ L.neg }}</span></h3>
      <div class="help" style="margin-bottom:10px" v-if="L.pos + L.neg < L.min_labels">Нужно ещё {{ L.min_labels - L.pos - L.neg }} оценок, чтобы веса начали влиять на предложения. Gemini получает оценки как примеры уже сейчас.</div>
      <div class="grid g2">
        <div><div class="small" style="color:var(--good);margin-bottom:6px">За «проект»</div>
          <div v-for="i in L.positive" :key="i.f" class="row" style="padding:3px 0;flex-wrap:nowrap"><span>{{ featTitle(i.f) }}</span><span class="dim small" :title="'проект: ' + i.pos + ', не проект: ' + i.neg">{{ i.pos }} / {{ i.neg }}</span><span class="sp"></span>
            <b class="num" style="color:var(--good)">+{{ i.w }}</b><button v-if="pinnable(i.f)" class="btn sm icon ghost" @click="pin(i)" title="Сделать постоянным признаком" aria-label="Закрепить признак"><Icon name="pin"/></button></div>
          <div v-if="!L.positive.length" class="dim small">пока нет</div></div>
        <div><div class="small" style="color:var(--bad);margin-bottom:6px">Против</div>
          <div v-for="i in L.negative" :key="i.f" class="row" style="padding:3px 0;flex-wrap:nowrap"><span>{{ featTitle(i.f) }}</span><span class="dim small" :title="'проект: ' + i.pos + ', не проект: ' + i.neg">{{ i.pos }} / {{ i.neg }}</span><span class="sp"></span>
            <b class="num" style="color:var(--bad)">{{ i.w }}</b><button v-if="pinnable(i.f)" class="btn sm icon ghost" @click="pin(i)" title="Сделать постоянным признаком" aria-label="Закрепить признак"><Icon name="pin"/></button></div>
          <div v-if="!L.negative.length" class="dim small">пока нет</div></div>
      </div>
      <div class="row" style="margin-top:12px;gap:6px" v-if="L.reasons.length"><span class="small muted">Почему отклоняешь:</span><span class="chip" v-for="r in L.reasons">{{ r.title }} · {{ r.n }}</span></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h3>Добавить признак</h3>
      <div class="row" style="align-items:flex-end">
        <label class="f" style="flex:1;min-width:180px">Название<input v-model="f.name" placeholder="напр. Ссылка на Telegram"></label>
        <label class="f">Тип<select v-model="f.kind"><option value="domain">домен в ссылках</option><option value="keyword">слово в био</option>
          <option value="regex">regex по био</option><option value="hint">подсказка для ИИ</option></select></label>
        <label class="f" style="flex:2;min-width:240px">{{ f.kind === 'hint' ? 'Текст для ИИ' : 'Шаблон (варианты через |)' }}<input v-model="f.pattern" :placeholder="ph[f.kind]"></label>
        <label class="f" style="width:90px">Вес<input type="number" step="0.5" v-model.number="f.weight" :disabled="f.kind==='hint'"></label>
        <button class="btn primary" @click="add" :disabled="!f.name || !f.pattern"><Icon name="plus"/>Добавить</button></div>
      <div class="help" style="margin-top:10px">Score ≥ 3 без ИИ уже считается «похож на проект». Подсказки не дают баллов, но ИИ учитывает их при решении. После добавления признака кандидаты будут перепроверены в следующем прогоне.</div>
    </div>
    <div class="card"><table><tr><th>Вкл</th><th>Название</th><th>Тип</th><th>Шаблон</th><th class="num">Вес</th><th></th></tr>
      <tr v-for="s in rows" :key="s.id"><td><input type="checkbox" :checked="s.enabled" @change="s.enabled = $event.target.checked; save(s)"></td>
        <td><input v-model="s.name" @change="save(s)" style="width:100%"></td><td class="small muted">{{ kinds[s.kind] }}</td>
        <td><input v-model="s.pattern" @change="save(s)" style="width:100%"></td>
        <td class="num"><input type="number" step="0.5" v-model.number="s.weight" @change="save(s)" style="width:70px" :disabled="s.kind==='hint'"></td>
        <td><button class="btn sm icon ghost" @click="del(s)" :aria-label="'Удалить признак ' + s.name" title="Удалить признак"><Icon name="trash-2"/></button></td></tr></table></div>
  </div>`,
  setup() {
    const rows = ref([]), f = reactive({ name: '', kind: 'domain', pattern: '', weight: 2 });
    const kinds = { domain: 'домен', keyword: 'слово', regex: 'regex', hint: 'подсказка ИИ' };
    const ph = { domain: 't.me|whop.com', keyword: 'free group|vip', regex: '\\bdm\\s+me\\b', hint: 'Опиши признак словами' };
    const L = ref(null);
    const load = async () => { rows.value = await api('/api/signals'); L.value = await api('/api/learned'); };
    const pinnable = f => f.startsWith('domain:') || f.startsWith('word:');
    async function pin(i) {
      const isDomain = i.f.startsWith('domain:'), pat = i.f.split(':').slice(1).join(':');
      await api('/api/signals', { method: 'POST', body: { name: (i.w > 0 ? 'Выучено: ' : 'Против: ') + pat, kind: isDomain ? 'domain' : 'keyword',
        pattern: pat, weight: Math.max(-5, Math.min(5, Math.round(i.w * 2) / 2)) } });
      toast('Признак закреплён'); load();
    }
    async function add() { try { await api('/api/signals', { method: 'POST', body: { ...f } }); f.name = f.pattern = ''; load(); toast('Признак добавлен'); } catch (e) { toast(e.message, true); } }
    async function save(s) { await api('/api/signals/' + s.id, { method: 'PUT', body: { ...s, enabled: !!s.enabled } }); }
    async function del(s) { await api('/api/signals/' + s.id, { method: 'DELETE' }); load(); }
    onMounted(load);
    return { rows, f, kinds, ph, add, save, del, L, pin, pinnable, featTitle };
  },
};

const Votes = {
  components: { Who, Links, Vote },
  template: `
  <div>
    <div class="head"><h1>Оценки</h1><span class="sub">кому ставили «проект / не проект», за что и где — всё можно поправить</span><span class="sp"></span>
      <input v-model="q" placeholder="Поиск по нику" aria-label="Поиск по нику" style="width:180px">
      <select v-model="fl" aria-label="Фильтр оценок"><option value="">Все оценки</option><option value="-1">Только «не проект»</option><option value="1">Только «проект»</option></select>
      <select v-model="fr" v-if="fl !== '1'"><option value="">Любая причина</option><option v-for="(t, k) in data?.reasons" :value="k">{{ t }}</option><option value="none">без причины</option></select></div>
    <div class="tabs">
      <button :class="{on: tab==='votes'}" @click="tab='votes'">Оценки · {{ data?.votes.length ?? '' }}</button>
      <button :class="{on: tab==='hidden'}" @click="tab='hidden'">Скрытые площадки · {{ data?.hidden.length ?? '' }}</button>
      <button :class="{on: tab==='log'}" @click="tab='log'">История изменений</button></div>
    <Skel v-if="!data" :rows="6"/>

    <div class="card" v-if="data && tab==='votes'">
      <div class="help" style="margin-bottom:10px">Поменяй оценку или причину прямо в строке. Если сменить «не проект» на «проект», отклонённый аккаунт вернётся в кандидаты, а скрытое предложение проекта — в «Предложения». Снять оценку — значит забыть её: модель пересчитается без неё.</div>
      <table><tr><th>Аккаунт</th><th>Оценка и причина</th><th>Где поставлена</th><th>Когда</th><th>Сейчас</th><th></th></tr>
        <tr v-for="v in shown" :key="v.username">
          <td style="max-width:260px"><Who :u="v.username" :src="v.avatar" :sub="fmt(v.followers) + ' · ' + (v.full_name || '')"/>
            <div class="bio" v-if="v.bio" style="margin-top:4px">{{ v.bio }}</div></td>
          <td><Vote :u="v.username" :vote="v.label" :reason="v.reason" via="history" @voted="load"/></td>
          <td class="small muted">{{ data.vias[v.via] || (v.via ? v.via : 'раньше (до журнала)') }}</td>
          <td class="small muted" :title="dtFull(v.ts)">{{ dt(v.ts) }}<div v-if="v.changes > 1" class="dim">изменялась {{ v.changes }} раз</div></td>
          <td><span :class="['chip', ROLE[v.role]?.[1]]">{{ ROLE[v.role]?.[0] || v.role || '—' }}</span>
            <div class="small dim" v-if="v.niche" style="margin-top:3px">{{ v.niche }}</div></td>
          <td><button class="btn sm" @click="clear(v)" title="Снять оценку">Снять</button></td></tr></table>
      <Empty v-if="!shown.length" icon="thumbs-up" text="Под этот фильтр оценок нет"/>
    </div>

    <div class="card" v-if="data && tab==='hidden'">
      <div class="help" style="margin-bottom:10px">Площадки, которые ты скрыл из предложений «в фокус». Они не учат модель проектов, но больше не предлагаются. Верни, если скрыл по ошибке.</div>
      <table><tr><th>Площадка</th><th>Почему предлагалась</th><th>Когда</th><th></th></tr>
        <tr v-for="h in data.hidden" :key="h.username"><td><Who :u="h.username" :src="h.avatar" :sub="fmt(h.followers)"/></td>
          <td class="small">{{ h.reason }}</td><td class="small muted">{{ dt(h.created) }}</td>
          <td style="white-space:nowrap"><button class="btn sm" @click="restore(h)">Вернуть в предложения</button>
            <button class="btn good sm" @click="toFocus(h)">В фокус</button></td></tr></table>
      <Empty v-if="!data.hidden.length" icon="eye" text="Скрытых площадок нет"/>
    </div>

    <div class="card" v-if="data && tab==='log'">
      <table><tr><th>Когда</th><th>Аккаунт</th><th>Действие</th><th>Где</th></tr>
        <tr v-for="l in data.log" :key="l.id"><td class="small muted">{{ dtFull(l.ts) }}</td><td><a :href="'#/a/' + l.username">@{{ l.username }}</a></td>
          <td><span class="row" style="gap:5px;display:inline-flex" :style="{color: l.label === 1 ? 'var(--good)' : l.label === -1 ? 'var(--bad)' : 'var(--muted)'}">
            <Icon :name="l.label === 1 ? 'thumbs-up' : l.label === -1 ? 'thumbs-down' : 'refresh-cw'" size="sm"/>{{ l.label === 1 ? 'проект' : l.label === -1 ? 'не проект' : 'оценка снята' }}</span><span class="dim small" v-if="l.reason"> · {{ data.reasons[l.reason] || l.reason }}</span></td>
          <td class="small muted">{{ data.vias[l.via] || l.via || '' }}</td></tr></table>
      <Empty v-if="!data.log.length" icon="history" text="Журнал пуст: изменения начнут записываться с этой версии"/>
    </div>
  </div>`,
  setup() {
    const data = ref(null), tab = ref('votes'), fl = ref(''), fr = ref(''), q = ref('');
    const load = async () => data.value = await api('/api/feedback');
    const shown = computed(() => (data.value?.votes || []).filter(v =>
      (!fl.value || String(v.label) === fl.value) && (!fr.value || fl.value === '1' || (fr.value === 'none' ? !v.reason : v.reason === fr.value)) &&
      (!q.value || v.username.includes(q.value.toLowerCase().replace('@', '')))));
    async function clear(v) { await api('/api/feedback/' + v.username, { method: 'POST', body: { label: null, via: 'history' } }); toast('Оценка снята'); load(); }
    async function restore(h) { await api(`/api/suggestions/${h.username}/focus/restore`, { method: 'POST' }); toast('Вернул в предложения'); load(); }
    async function toFocus(h) { await api(`/api/suggestions/${h.username}/focus/accept`, { method: 'POST' }); toast('@' + h.username + ' в фокусе'); load(); }
    onMounted(load);
    return { data, tab, fl, fr, q, shown, load, clear, restore, toFocus, dtFull, ...H };
  },
};

const Runs = {
  template: `
  <div>
    <div class="head"><h1>Прогоны</h1><span class="sp"></span><button class="btn primary" :disabled="st?.pipeline.running" @click="runNow"><Icon name="play"/>Запустить сейчас</button></div>
    <div class="split">
      <div class="card"><table><tr><th>#</th><th>Запуск</th><th>Тип</th><th>Статус</th><th class="num">Постов</th><th class="num" title="Новых постов / уже известных (повторно не разбирались) / пропавших">Новых / известн. / удал.</th><th class="num">Предлож.</th><th class="num">Apify</th></tr>
        <tr v-for="r in rows" :key="r.id" class="click" @click="open(r.id)" :style="{background: sel?.id===r.id ? 'var(--primary-soft)' : ''}">
          <td class="dim">{{ r.id }}</td><td>{{ dt(r.started) }}</td><td class="small muted">{{ trig[r.trigger] || r.trigger }}</td>
          <td><span :class="['chip', {ok:'g', partial:'w', error:'r', interrupted:'r', running:'c'}[r.status]]">{{ r.status === 'running' ? r.stage : st_[r.status] || r.status }}</span></td>
          <td class="num">{{ (r.stats.focus_posts || 0) + (r.stats.tagged_posts || 0) }}</td>
          <td class="num small">{{ r.stats.posts_new != null ? r.stats.posts_new + ' / ' + r.stats.posts_known + ' / ' + r.stats.posts_deleted : '' }}</td>
          <td class="num">{{ r.stats.new_suggestions ?? '' }}</td>
          <td class="num small">{{ r.apify_usd ? '$' + r.apify_usd.toFixed(3) : '' }}</td></tr></table>
        <Empty v-if="!rows.length" icon="history" text="Ещё не было прогонов — запусти анализ кнопкой сверху"/></div>
      <div class="card"><h3>Журнал {{ sel ? '#' + sel.id : '' }}</h3><pre class="log" v-if="sel">{{ sel.log || '…' }}</pre><Empty v-else icon="history" text="Выбери прогон слева"/></div>
    </div>
  </div>`,
  setup() {
    const rows = ref([]), sel = ref(null);
    const trig = { manual: 'вручную', startup: 'при запуске', auto: 'по расписанию', snapshot: 'снимок подписчиков', bulk: 'большой разбор', recheck: 'перепроверка', content: 'контент и разборы', apify: 'быстрый проход (Apify)', classify: 'проверка ИИ', discover: 'поиск новых проектов' };
    const st_ = { ok: 'готово', partial: 'частично', error: 'ошибка', interrupted: 'прерван' };
    const load = async () => { rows.value = await api('/api/runs'); if (!sel.value && rows.value[0]) open(rows.value[0].id); };
    const open = async id => sel.value = await api('/api/runs/' + id);
    let t;
    onMounted(() => { load(); t = setInterval(() => { if (store.st?.pipeline.running) { load(); sel.value && open(sel.value.id); } }, 3000); });
    onUnmounted(() => clearInterval(t));
    return { rows, sel, open, trig, st_, st: computed(() => store.st), runNow, dt };
  },
};

const Settings = {
  template: `
  <div>
    <div class="head"><h1>Настройки</h1><span class="sub">меняются сразу для следующих прогонов</span><span class="sp"></span>
      <button class="btn primary" @click="saveSettings" :disabled="!s"><Icon name="check"/>Сохранить настройки</button></div>
    <div class="grid g2">
      <div class="card"><h3>Instagram-сессия (куки)</h3>
        <p class="small muted" style="margin-top:0">Нужна для 18+ профилей и сбора без Apify. Экспортируй куки instagram.com расширением Cookie-Editor (Export → JSON) и вставь сюда. Лучше использовать отдельный, не основной аккаунт.</p>
        <textarea v-model="cookies" placeholder='[{"name":"sessionid","value":"..."}, ...]'></textarea>
        <div class="row" style="margin-top:10px"><button class="btn primary" @click="saveCookies" :disabled="!cookies.trim()"><Icon name="check"/>Сохранить куки</button>
          <button class="btn" @click="check" :disabled="checking"><Icon :name="checking ? 'loader-circle' : 'refresh-cw'" :spin="checking"/>{{ checking ? 'Проверяю…' : 'Проверить сессию' }}</button>
          <span class="small row" style="gap:4px" v-if="st" :style="{color: st.pipeline.session.ok ? 'var(--good)' : st.pipeline.session.ok === false ? 'var(--bad)' : 'var(--muted)'}">
            <Icon :name="st.pipeline.session.ok ? 'circle-check' : 'circle-alert'" size="sm"/>{{ st.pipeline.session.message }}</span></div>
      </div>
      <div class="card" v-for="grp in GROUPS" :key="grp.title">
        <h3 class="row" style="gap:6px"><Icon :name="grp.icon" size="sm"/>{{ grp.title }}</h3>
        <div class="status-line" v-if="grp.ai && st" style="margin-bottom:12px"><span>Gemini <b>{{ st.gemini.model }}</b>: {{ st.gemini.requests }} запросов / {{ fmt(st.gemini.tokens) }} токенов сегодня</span>
          <span v-if="usage">Apify за месяц: <b>{{ '$' + usage.used }}</b> из {{ '$' + usage.limit }}</span></div>
        <div class="grid g2" v-if="s" style="gap:12px">
          <label class="f" v-for="k in grp.keys" :key="k" :for="'set-' + k">{{ labels[k] }}
            <select v-if="k==='tagged_source'" :id="'set-' + k" v-model="s[k]"><option value="browser">браузер с сессией (бесплатно)</option><option value="auto">Apify для открытых, браузер для 18+</option><option value="apify">только Apify</option></select>
            <input v-else-if="k==='download_dir'" :id="'set-' + k" type="text" v-model.trim="s[k]" :placeholder="'по умолчанию: ' + (defaultDir || 'папка Загрузки')">
            <select v-else-if="k==='llm_provider'" :id="'set-' + k" v-model="s[k]"><option value="gemini">Gemini (облако, 400 запросов/день)</option><option value="ollama">Ollama (локальная, без лимитов)</option></select>
            <select v-else-if="k==='region_filter'" :id="'set-' + k" v-model="s[k]"><option value="us">только США (и «не ясно»)</option><option value="">любой регион</option></select>
            <input v-else-if="['ollama_url','ollama_model','allowed_langs'].includes(k)" :id="'set-' + k" type="text" v-model.trim="s[k]">
            <input v-else :id="'set-' + k" type="number" step="any" v-model.number="s[k]"></label></div>
        <div class="help" style="margin-top:10px" v-if="grp.help">{{ grp.help }}</div>
        <div class="row" style="margin-top:12px" v-if="grp.ai"><button class="btn" @click="checkOllama"><Icon name="refresh-cw"/>Проверить Ollama</button>
          <span class="small row" style="gap:4px" v-if="oll" :style="{color: oll.ok ? 'var(--good)' : 'var(--bad)'}"><Icon :name="oll.ok ? 'circle-check' : 'circle-alert'" size="sm"/>{{ oll.message }}</span></div>
      </div>
      <div class="card"><h3>База данных и перенос</h3>
        <p class="small muted" style="margin-top:0">Вся база — один файл <code>data/perliv.db</code> (режим без -wal файлов), аватарки в <code>data/avatars</code>. Для переноса между Windows и Mac: закрой программу и скопируй всю папку проекта (или только <code>data</code> и <code>.env</code>). Окружение Python создаётся отдельно под каждую ОС при первом запуске. После каждого прогона делается автобэкап (хранятся последние 10).</p>
        <div class="row"><span class="small">Проверка целостности: <b :style="{color: st?.db.integrity === 'ok' ? 'var(--good)' : 'var(--bad)'}">{{ st?.db.integrity }}</b></span><span class="sp"></span>
          <button class="btn" @click="backup"><Icon name="download"/>Скачать бэкап</button></div>
      </div>
    </div>
  </div>`,
  setup() {
    const s = ref(null), cookies = ref(''), checking = ref(false), usage = ref(null);
    const labels = {
      auto_runs_per_day: 'Авто-прогонов в день', auto_interval_hours: 'Интервал между прогонами, ч',
      focus_scrolls_first: 'Первый скан паблика: прокруток (×12 постов)', focus_scrolls_next: 'Повторный скан: прокруток',
      tagged_limit_first: 'Упоминаний проекта: первый проход', tagged_limit_next: 'Упоминаний проекта: повторно',
      discover_new: 'Искать проекты вне фокуса в авто-прогонах (1/0). 0 = только фокус, поиск снаружи кнопкой', focus_first: 'Сначала фокус (1/0): пока ждут кандидаты из фокуса, не искать снаружи', focus_per_run: 'Фокус-пабликов за прогон (по кругу)', enrich_per_run: 'Проверять кандидатов за прогон',
      max_pages_per_run: 'Жёсткий лимит страниц Instagram за прогон', delay_min: 'Пауза между страницами от, с', delay_max: 'Пауза до, с',
      tagged_source: 'Источник упоминаний', apify_daily_cap_usd: 'Apify: лимит в день, $',
      apify_bulk_usd: 'Apify: бюджет быстрого прохода, $', apify_enrich_max: 'Apify: профилей кандидатов за быстрый проход',
      gemini_parallel_max: 'Gemini в помощь Ollama: запросов за прогон (0 = только Ollama)', gemini_daily_cap: 'Gemini: запросов в день (из 500)', gemini_rpm: 'Gemini: запросов в минуту (из 15)', llm_batch: 'Аккаунтов в одном запросе к ИИ',
      suggest_focus_min_ads: 'Предлагать в фокус от N реклам', growth_window_hours: 'Окно оценки роста после рекламы, ч',
      snapshot_interval_hours: 'Снимок подписчиков проектов каждые, ч (0 = выкл)', explore_sources_per_run: 'Разведка: площадок за прогон',
      keywords_per_run: 'Поисковых запросов за прогон', search_scrolls: 'Прокруток выдачи поиска', ai_niche_ideas: 'ИИ-идеи ниш раз в день (1/0)',
      learn_min_labels: 'Оценок до включения обучения',
      download_dir: 'Папка для скачивания контента', download_refresh_max: 'Скачивание: обновлять ссылки макс. постов',
      llm_provider: 'ИИ для проверки', ollama_url: 'Ollama: адрес сервера', ollama_model: 'Ollama: модель',
      ollama_batch: 'Ollama: аккаунтов в пачке (меньше — легче видеокарте)', ollama_pause: 'Ollama: пауза между пачками, с',
      triage_per_run: 'Сортировать очередь ИИ за прогон (без Instagram)', bulk_enrich: 'Большой разбор: открыть профилей',
      reel_views: 'Собирать просмотры reels (1/0, +1 страница на паблик раз в 3 дня)', viral_ratio: '«Залетело»: во сколько раз выше обычного',
      viral_days: '«Залетевшее»: за сколько дней', tag_viral_per_run: 'Размечать залетевших постов ИИ за прогон',
      teardown_per_run: 'Разборов проектов из фокуса за прогон',
      min_followers: 'Проекты от N подписчиков', region_filter: 'Регион проектов', allowed_langs: 'Языки био (через запятую, пусто — любые)',
    };
    const GROUPS = [
      { title: 'Расписание', icon: 'calendar', keys: ['auto_runs_per_day', 'auto_interval_hours', 'snapshot_interval_hours'] },
      { title: 'Сбор в Instagram', icon: 'radar', keys: ['discover_new', 'focus_per_run', 'focus_first', 'focus_scrolls_first', 'focus_scrolls_next', 'enrich_per_run',
          'max_pages_per_run', 'delay_min', 'delay_max', 'tagged_source', 'tagged_limit_first', 'tagged_limit_next', 'apify_daily_cap_usd',
          'apify_bulk_usd', 'apify_enrich_max',
          'explore_sources_per_run', 'keywords_per_run', 'search_scrolls', 'suggest_focus_min_ads', 'growth_window_hours'],
        help: 'Чем больше страниц за прогон и короче паузы, тем быстрее сбор, но выше риск ограничений со стороны Instagram.' },
      { title: 'ИИ', icon: 'bot', ai: true, keys: ['llm_provider', 'ollama_url', 'ollama_model', 'ollama_batch', 'ollama_pause', 'gemini_parallel_max', 'gemini_daily_cap',
          'gemini_rpm', 'llm_batch', 'triage_per_run', 'bulk_enrich', 'ai_niche_ideas'],
        help: 'Если Ollama недоступна, прогон сам переключится на Gemini и напишет об этом в журнале.' },
      { title: 'Фильтры проектов и обучение', icon: 'filter', keys: ['min_followers', 'region_filter', 'allowed_langs', 'learn_min_labels'],
        help: 'Проекты меньше порога, не из США или не на разрешённом языке не пропадают: они помечаются «вне фильтра» и не предлагаются. Твои отслеживаемые проекты фильтр не трогает.' },
      { title: 'Контент, «Залетевшее» и скачивание', icon: 'flame', keys: ['reel_views', 'viral_ratio', 'viral_days', 'tag_viral_per_run',
          'teardown_per_run', 'download_dir', 'download_refresh_max'],
        help: 'Скачанное сохраняется в «папка/perliv/<аккаунт>»: картинки, видео, слайды каруселей и index.csv с датами, ссылками и подписями. Уже скачанные файлы не качаются повторно.' },
    ];
    const defaultDir = ref('');
    onMounted(async () => {
      s.value = await api('/api/settings');
      if (!s.value.download_dir) defaultDir.value = store.st?.download_dir || '';
      try { usage.value = await api('/api/apify-usage'); } catch (e) {}
    });
    async function saveSettings() { s.value = await api('/api/settings', { method: 'POST', body: s.value }); toast('Настройки сохранены'); refreshState(); }
    async function saveCookies() { try { const r = await api('/api/cookies', { method: 'POST', body: { raw: cookies.value } }); toast('Сохранено кук: ' + r.saved); cookies.value = ''; check(); } catch (e) { toast(e.message, true); } }
    async function check() { checking.value = true; try { await api('/api/session/check', { method: 'POST' }); await refreshState(); } finally { checking.value = false; } }
    async function backup() { const r = await api('/api/backup', { method: 'POST' }); location.href = withToken('/api/backup/' + r.file); }
    const oll = ref(null);
    async function checkOllama() { await saveSettings(); oll.value = await api('/api/llm/check', { method: 'POST' }); }
    return { s, cookies, checking, usage, labels, GROUPS, defaultDir, oll, checkOllama, saveSettings, saveCookies, check, backup, st: computed(() => store.st), fmt };
  },
};

// ---------- login (server mode) ----------
const Login = {
  template: `
  <div class="login-wrap"><form class="card login" @submit.prevent="submit">
    <div class="brand" style="margin-bottom:6px"><div class="logo"><Icon name="share-2"/></div>Perliv</div>
    <label for="pw" class="small muted">Пароль</label>
    <input id="pw" v-model="pw" autofocus type="password" autocomplete="current-password" required :disabled="busy">
    <label class="small row" style="gap:6px"><input type="checkbox" v-model="remember"> запомнить на этом устройстве (7 дней)</label>
    <div v-if="err" class="small" style="color:var(--bad)" role="alert">{{ err }}</div>
    <button class="btn primary" :disabled="busy || !pw"><Icon :name="busy ? 'loader-circle' : 'log-out'" :spin="busy" style="transform:scaleX(-1)"/>Войти</button>
  </form></div>`,
  setup() {
    const pw = ref(''), remember = ref(false), err = ref(''), busy = ref(false);
    async function submit() {
      busy.value = true; err.value = '';
      try {
        const r = await api('/api/login', { method: 'POST', body: { password: pw.value, remember: remember.value } });
        auth.set(r.token, r.exp, remember.value);
        pw.value = ''; store.login = false; store.ver++; refreshState();
      } catch (e) { err.value = e.message; }
      busy.value = false;
    }
    return { pw, remember, err, busy, submit };
  },
};
function logout() { auth.clear(); store.st = null; store.login = true; }

// ---------- shell ----------
const PAGES = { home: Home, dash: Dashboard, finds: Finds, viral: Viral, focus: Focus, projects: Projects, a: Account, candidates: Candidates, dynamics: Dynamics, niches: Niches,
  explore: Explore, graph: Graph, signals: Signals, votes: Votes, runs: Runs, settings: Settings };
// Navigation grouped by purpose: results first, then the data behind them, then the controls.
const NAV = [
  ['Результаты', [['home', 'rocket', 'Кандидаты в проекты'], ['dash', 'layout-dashboard', 'Дашборд'], ['finds', 'target', 'Находки'], ['viral', 'flame', 'Залетевшее']]],
  ['Данные', [['focus', 'radar', 'Фокус'], ['projects', 'briefcase', 'Проекты'], ['candidates', 'users', 'Кандидаты'],
    ['dynamics', 'trending-up', 'Динамика'], ['niches', 'layers', 'Ниши'], ['explore', 'sparkles', 'Новые ниши'], ['graph', 'share-2', 'Граф переливов']]],
  ['Система', [['signals', 'sliders-horizontal', 'Признаки'], ['votes', 'thumbs-up', 'Оценки'], ['runs', 'history', 'Прогоны'], ['settings', 'settings', 'Настройки']]],
];

function parseRoute() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  store.route = { name: PAGES[name] ? name : 'home', arg: arg ? decodeURIComponent(arg) : null };
}

const app = createApp({
  components: { Login },
  template: `
  <Login v-if="store.login"/>
  <div v-else :class="['layout', {'menu-open': store.menu}]">
    <header class="topbar">
      <button class="btn icon ghost" @click="store.menu = !store.menu" aria-label="Открыть меню" :aria-expanded="store.menu"><Icon name="menu" size="lg"/></button>
      <div class="brand"><div class="logo"><Icon name="share-2"/></div>Perliv</div>
      <span class="sp"></span><span v-if="st?.pipeline.running" class="pulse" title="Идёт анализ"></span>
    </header>
    <div class="scrim" @click="store.menu = false"></div>
    <aside class="side" aria-label="Навигация">
      <div class="brand"><div class="logo"><Icon name="share-2"/></div>Perliv</div>
      <nav class="nav">
        <template v-for="grp in NAV" :key="grp[0]">
          <div class="nav-group">{{ grp[0] }}</div>
          <a v-for="n in grp[1]" :key="n[0]" :href="'#/' + n[0]" @click="store.menu = false"
             :class="{on: route.name === n[0] || (n[0]==='projects' && route.name==='a')}" :aria-current="route.name === n[0] ? 'page' : null">
            <Icon :name="n[1]"/>{{ n[2] }}<span class="badge" v-if="n[0]==='focus' && st?.pending">{{ st.pending }}</span></a>
        </template>
      </nav>
      <div class="foot">
        <div v-if="st?.pipeline.running" class="row" style="gap:8px;color:var(--text)"><span class="pulse"></span>{{ st.pipeline.stage }}</div>
        <div v-else-if="st" class="row" style="gap:6px"><Icon name="calendar" size="sm"/>След. анализ {{ ago(st.schedule.next) }}</div>
        <button v-if="authed" class="btn sm ghost" @click="logout" style="justify-content:flex-start"><Icon name="log-out"/>Выйти</button>
        <div class="theme-switch" role="group" aria-label="Тема оформления">
          <button v-for="t in THEMES" :key="t[0]" :class="{on: store.theme === t[0]}" @click="setTheme(t[0])" :title="t[2]" :aria-label="t[2]" :aria-pressed="store.theme === t[0]"><Icon :name="t[1]"/></button>
        </div>
      </div>
    </aside>
    <main class="main"><component :is="page" :arg="route.arg" :key="route.name + (route.arg || '') + ':' + store.ver"/></main>
    <div v-if="store.toast" :class="['toast', {err: store.toast.err}]" role="status" aria-live="polite">
      <Icon :name="store.toast.err ? 'circle-alert' : 'circle-check'" :style="{color: store.toast.err ? 'var(--bad)' : 'var(--good)'}" style="margin-top:2px"/><span>{{ store.toast.msg }}</span></div>
  </div>`,
  setup() {
    parseRoute();
    window.addEventListener('hashchange', parseRoute);
    refreshState();
    setInterval(refreshState, 3000);
    // "system" theme follows the OS switch live; charts re-read colours on re-mount
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (store.theme === 'system') store.ver++; });
    return { NAV, THEMES, setTheme, logout, authed: computed(() => !store.login && !!auth.get()), store, route: computed(() => store.route), st: computed(() => store.st), page: computed(() => PAGES[store.route.name]), ago };
  },
});
app.component('Icon', Icon);
app.component('Skel', Skel);
app.component('Empty', Empty);
app.mount('#app');

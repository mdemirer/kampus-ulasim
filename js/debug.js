// Gizli test ekranı: Bilgi sekmesinde sürüm yazısına 4 saniye içinde 7 kez dokun ya da adrese #debug ekle.

const SAMPLE_ANNS = [
  'KM18 SABANCI ÜNİ.-KURTKÖY METRO hattında saat 16:00 Kurtköy Metro kalkışlı seferimiz araç arızası nedeniyle yapılamayacaktır.',
  'KM18 hattının Sabancı Üniversitesi kalkışlı 17:45 seferi iptal edilmiştir.',
  'Yol çalışması nedeniyle 12:00-15:00 saatleri arasındaki KM18 seferleri yapılamayacaktır.',
  'KM18 hattı Eski Ankara Caddesi\'ndeki çalışma nedeniyle geçici olarak Fatih Mahallesi güzergâhını kullanmaktadır.',
];

function presets(C, nowMs) {
  const today = C.dateKeyOf(nowMs);
  const nextDow = (dow) => {
    for (let i = 0; i < 7; i++) {
      const k = C.addDays(today, i);
      if (C.dowOfKey(k) === dow) return k;
    }
    return today;
  };
  return [
    [`${nextDow(5)}T23:50`, 'Cuma 23:50', 'Kurtköy 00:45 gece seferi; Pzt–Per 23:55 görünmemeli'],
    [`${nextDow(6)}T01:30`, 'Cumartesi 01:30', 'Kadıköy 02:00 (Cuma gecesi seferi)'],
    [`${nextDow(0)}T01:30`, 'Pazar 01:30', 'Kadıköy 02:00 (Cumartesi gecesi seferi)'],
    [`${nextDow(1)}T01:30`, 'Pazartesi 01:30', 'Kadıköy gece seferi olmamalı'],
    [`${nextDow(4)}T23:50`, 'Perşembe 23:50', 'Kurtköy 23:55 görünmeli'],
    [`${nextDow(1)}T15:44`, 'Pazartesi 15:44', 'KM18 15:50 (E) atlanmalı'],
    [`${nextDow(5)}T20:00`, 'Cuma 20:00', 'Çekmeköy bir sonraki: Pazartesi'],
    ['2027-01-01T09:00', '1 Ocak 2027', 'Program süresi doldu uyarısı'],
  ];
}

function attemptsTable(ctx, attempts) {
  const { esc, I } = ctx;
  if (!attempts?.length) return '<p class="muted">Henüz deneme yok.</p>';
  return `<table class="dbg-table"><thead><tr><th>Yöntem</th><th>Sonuç</th><th>ms</th></tr></thead><tbody>${attempts.map((a) => `
    <tr class="${a.ok ? 'ok' : 'bad'}"><td>${esc(I.STRATEGY_LABELS[a.strategy] || a.strategy)}</td>
    <td>${a.ok ? `Çalıştı · ${a.count} satır` : esc(a.error || '?')}${a.status ? ` · HTTP ${a.status}` : ''}
    ${a.snippet && !a.ok ? `<details><summary>Yanıt</summary><pre>${esc(a.snippet)}</pre></details>` : ''}</td>
    <td>${a.ms ?? ''}</td></tr>`).join('')}</tbody></table>`;
}

function listDiff(a = [], b = []) {
  const first = (e) => String(e).split(/\s+/)[0];
  const A = new Set(a.map(first));
  const B = new Set(b.map(first));
  return { onlyA: [...A].filter((x) => !B.has(x)), onlyB: [...B].filter((x) => !A.has(x)) };
}

function planSection(ctx) {
  const { state, esc, ago } = ctx;
  const k = state.km18;
  const fb = state.km18Fallback;
  const lists = k.lists || { fromCampus: fb.fromCampus, toCampus: fb.toCampus };
  const rows = [];
  for (const dir of ['fromCampus', 'toCampus']) {
    for (const t of ['weekday', 'saturday', 'sunday']) {
      const d = listDiff(lists[dir][t], fb[dir][t]);
      rows.push(`<tr><td>${dir === 'fromCampus' ? 'Kampüsten' : 'Kampüse'}</td><td>${{ weekday: 'Hafta içi', saturday: 'Cumartesi', sunday: 'Pazar' }[t]}</td><td>${lists[dir][t].length}</td>
        <td>${d.onlyA.length || d.onlyB.length ? `${d.onlyA.length ? `+${esc(d.onlyA.join(' '))}` : ''} ${d.onlyB.length ? `−${esc(d.onlyB.join(' '))}` : ''}` : 'aynı'}</td></tr>`);
    }
  }
  return `<section class="dbg">
    <h2>KM18 tarifesi</h2>
    <p>Kaynak: <b>${{ bundled: 'gömülü yedek', api: 'İBB (bu oturum)', cache: 'İBB (önbellek)' }[k.source]}</b>${k.fetchedAt ? ` · ${ago(k.fetchedAt)}` : ''}${k.strategy ? ` · ${esc(k.strategy)}` : ''}</p>
    ${k.mappingBy ? `<p>Yön eşlemesi: ${esc(k.mappingBy)}</p>` : ''}
    ${k.error ? `<p class="bad">Son hata: ${esc(k.error)}</p>` : ''}
    <table class="dbg-table"><thead><tr><th>Yön</th><th>Gün</th><th>Sefer</th><th>Gömülüye göre fark</th></tr></thead><tbody>${rows.join('')}</tbody></table>
    <p><button type="button" class="btn" data-dbg="plan-reset">Önbelleği sil, gömülü tarifeye dön</button></p>
  </section>`;
}

function annSection(ctx) {
  const { state, esc, ago, C } = ctx;
  const a = state.ann;
  const rows = state.analyses.map((x) => {
    const an = x.analysis;
    const status = [x.standing && 'kalıcı not', x.expired && 'süresi geçmiş', state.dismissed.has(x.ann.id) && 'gizlendi', x.ann.fake && 'test'].filter(Boolean).join(', ') || 'uyarı bandında';
    return `<li>
      <p>${esc(x.ann.text)}</p>
      <p class="muted">${Number.isFinite(x.ann.updatedMs) ? `${esc(C.fmtDateLong(C.dateKeyOf(x.ann.updatedMs)))} ${C.fmtClock(x.ann.updatedMs)}` : `tarih okunamadı (${esc(x.ann.updatedRaw || '-')})`} · ${esc(status)}</p>
      <p class="muted">İptal: ${an.isCancel ? 'evet' : 'hayır'} · gün ${an.serviceKey}${an.explicitDate ? ' (metinden)' : ''} · yön ipucu ${an.dirHint || 'yok'} · saatler ${an.times.join(' ') || '-'}${an.ranges.length ? ` · aralık ${an.ranges.map((r) => `${C.fmtHM(r.start)}–${C.fmtHM(r.end)}`).join(', ')}` : ''}</p>
      ${an.items.length ? `<p class="ok">İşaretlenen: ${an.items.map((i) => `${i.time} ${i.dir === 'fromCampus' ? 'kampüsten' : 'kampüse'}`).join(', ')}</p>` : ''}
      ${an.isCancel && an.unresolved.length ? `<p class="bad">Tarifede bulunamayan saat: ${an.unresolved.join(' ')}</p>` : ''}
    </li>`;
  }).join('');
  return `<section class="dbg">
    <h2>Duyurular</h2>
    <p>${a.fetchedAt ? `Son alım ${ago(a.fetchedAt)} · ${esc(a.strategy || '')} · tüm hatlarda ${a.totalRows ?? '?'} duyuru, KM18 için ${a.items.length}` : 'Hiç alınamadı.'}${a.error ? ` · <span class="bad">${esc(a.error)}</span>` : ''}</p>
    ${rows ? `<ol class="dbg-list">${rows}</ol>` : '<p class="muted">KM18 için duyuru yok.</p>'}
    <p><button type="button" class="btn" data-dbg="undismiss">Gizlenen duyuruları geri getir</button></p>
  </section>`;
}

function previewSection(ctx) {
  const { state, C, esc } = ctx;
  const t = ctx.now();
  const km = state.km18Fallback && { ...state.km18Fallback, ...(state.km18.lists || {}) };
  const out = [];
  for (const dir of ['fromCampus', 'toCampus']) {
    const svcs = C.buildServices(state.shuttle, km, dir);
    const lines = state.shuttle.routes.map((r) => {
      const up = C.upcoming(svcs.get(r.id), t, { count: 3, cancellations: state.cancellations });
      const txt = up.map((x) => `${C.dateKeyOf(x.ms) !== C.dateKeyOf(t) ? `${C.DAY_SHORT[C.dowOfKey(x.dateKey)]} ` : ''}${x.time}${x.kind === 'iett' ? ' KM18' : ''}${x.cancelled ? ' (iptal)' : ''}`).join(', ');
      return `<tr><td>${esc(r.name)}</td><td>${esc(txt || '—')}</td></tr>`;
    }).join('');
    out.push(`<h3>${dir === 'fromCampus' ? 'Kampüsten' : 'Kampüse'}</h3><table class="dbg-table"><tbody>${lines}</tbody></table>`);
  }
  return `<section class="dbg"><h2>Sıradaki seferler (iki yön)</h2>${out.join('')}</section>`;
}

export function renderDebug(ctx) {
  const { state, esc, C, I, ago, CONFIG } = ctx;
  const t = ctx.now();
  const sim = state.sim;
  const sc = state.shuttleCheck;
  return `<div class="debug">
    <section class="dbg">
      <h2>Debug</h2>
      <p>Uygulama saati: <b id="dbg-now">${esc(C.fmtDateLong(C.dateKeyOf(t)))} ${C.fmtClock(t)}</b>${sim ? ' (test saati)' : ''}</p>
      <form id="dbg-sim" class="dbg-form">
        <label>Test saati (İstanbul)<input type="datetime-local" name="at" step="60" value="${C.msToWallInput(t)}"></label>
        <label class="check"><input type="checkbox" name="running" ${!sim || sim.running ? 'checked' : ''}> Saat aksın</label>
        <div class="row"><button type="submit" class="btn">Uygula</button><button type="button" class="btn ghost" data-dbg="sim-off">Gerçek saate dön</button></div>
      </form>
      <div class="presets">${presets(C, Date.now()).map(([v, l, d]) => `<button type="button" class="chip-btn" data-dbg-preset="${v}" title="${esc(d)}"><b>${esc(l)}</b><span>${esc(d)}</span></button>`).join('')}</div>
    </section>

    ${previewSection(ctx)}

    <section class="dbg">
      <h2>İBB bağlantısı</h2>
      <p>Telefonun İBB servislerine doğrudan ulaşıp ulaşamadığını her yöntemle ayrı ayrı dener.</p>
      <div class="row"><button type="button" class="btn" data-dbg="probe-plan">Tarifeyi dene</button><button type="button" class="btn" data-dbg="probe-duyuru">Duyuruları dene</button></div>
      <div id="dbg-probe"></div>
      <h3>Son otomatik deneme · tarife</h3>${attemptsTable(ctx, state.attempts.plan)}
      <h3>Son otomatik deneme · duyurular</h3>${attemptsTable(ctx, state.attempts.duyuru)}
      <form id="dbg-proxy" class="dbg-form">
        <label>Ara sunucu adresi (isteğe bağlı)<input type="url" name="proxy" placeholder="https://…workers.dev" value="${esc(ctx.proxyUrl())}"></label>
        <div class="row"><button type="submit" class="btn">Kaydet</button></div>
      </form>
    </section>

    ${planSection(ctx)}
    ${annSection(ctx)}

    <section class="dbg">
      <h2>Test duyurusu</h2>
      <p>Gerçek bir İETT duyurusu gibi işlenir. Duyuru saati, iptalin hangi güne uygulanacağını belirler.</p>
      <div class="presets">${SAMPLE_ANNS.map((s, i) => `<button type="button" class="chip-btn" data-dbg-sample="${i}"><span>${esc(s.slice(0, 60))}…</span></button>`).join('')}</div>
      <form id="dbg-fake" class="dbg-form">
        <label>Metin<textarea name="text" rows="3">${esc(SAMPLE_ANNS[0])}</textarea></label>
        <label>Duyuru saati<input type="datetime-local" name="at" step="60" value="${C.msToWallInput(t)}"></label>
        <div class="row"><button type="submit" class="btn">Ekle</button><button type="button" class="btn ghost" data-dbg="fake-clear">Test duyurularını sil</button></div>
      </form>
    </section>

    <section class="dbg">
      <h2>Okul sitesi</h2>
      <p>${sc ? (sc.ok ? `Okunabildi (${ago(sc.checkedAt)}). Güncel dönem: ${esc(sc.current || 'bulunamadı')}. ${sc.changed ? '<b class="bad">Uygulamadakinden farklı.</b>' : 'Uygulamadakiyle aynı.'}` : `Okunamadı (${ago(sc.checkedAt)}): ${esc(sc.error)}`) : 'Henüz denenmedi.'}</p>
      <p class="muted">Uygulamadaki dönem: ${esc(state.shuttle.term.name)}</p>
      <p><button type="button" class="btn" data-dbg="check-site">Şimdi dene</button></p>
    </section>

    <section class="dbg">
      <h2>Araçlar</h2>
      <div class="row wrap">
        <button type="button" class="btn" data-dbg="copy">Tanılamayı kopyala</button>
        <button type="button" class="btn" data-dbg="hard-reload">Önbelleği temizle ve yeniden yükle</button>
        <button type="button" class="btn ghost" data-dbg="lock">Debug bağlantısını gizle</button>
        <button type="button" class="btn ghost" data-tab-go="next">Çık</button>
      </div>
      <p class="muted">Sürüm ${esc(CONFIG.version)} · ${navigator.serviceWorker?.controller ? 'çevrimdışı önbellek etkin' : 'service worker yok'} · ${navigator.onLine ? 'çevrimiçi' : 'çevrimdışı'}</p>
    </section>
  </div>`;
}

function diagnostics(ctx) {
  const { state, CONFIG, C } = ctx;
  const t = ctx.now();
  const count = (l) => l && Object.fromEntries(['fromCampus', 'toCampus'].map((d) => [d, Object.fromEntries(Object.entries(l[d]).map(([k, v]) => [k, v.length]))]));
  return {
    version: CONFIG.version,
    realTime: new Date().toISOString(),
    appTime: `${C.dateKeyOf(t)} ${C.fmtClock(t)}`,
    sim: state.sim,
    dir: state.dir,
    userAgent: navigator.userAgent,
    online: navigator.onLine,
    sw: !!navigator.serviceWorker?.controller,
    proxy: ctx.proxyUrl(),
    preferred: { plan: ctx.LS.get('strat.plan'), duyuru: ctx.LS.get('strat.duyuru') },
    km18: { source: state.km18.source, fetchedAt: state.km18.fetchedAt, strategy: state.km18.strategy, mappingBy: state.km18.mappingBy, error: state.km18.error, counts: count(state.km18.lists), lists: state.km18.lists },
    attempts: state.attempts,
    announcements: { fetchedAt: state.ann.fetchedAt, error: state.ann.error, totalRows: state.ann.totalRows, items: state.ann.items },
    analyses: state.analyses.map((x) => ({ text: x.ann.text, fake: !!x.ann.fake, standing: x.standing, expired: x.expired, ...x.analysis })),
    shuttleCheck: state.shuttleCheck,
  };
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export function bindDebug(ctx) {
  const { state, C, I, CONFIG, LS, esc } = ctx;

  document.addEventListener('submit', (ev) => {
    const f = ev.target;
    if (!f.id?.startsWith('dbg-')) return;
    ev.preventDefault();
    const data = new FormData(f);
    if (f.id === 'dbg-sim') {
      const ms = C.wallToMs(String(data.get('at')));
      if (!Number.isFinite(ms)) { ctx.toast('Geçerli bir tarih gir'); return; }
      ctx.setSim({ baseMs: ms, setAt: Date.now(), running: data.get('running') === 'on' });
      ctx.toast('Test saati ayarlandı');
    } else if (f.id === 'dbg-proxy') {
      const v = String(data.get('proxy') || '').trim();
      if (v) LS.set('proxy', v); else LS.del('proxy');
      ctx.toast(v ? 'Ara sunucu kaydedildi' : 'Ara sunucu kaldırıldı');
    } else if (f.id === 'dbg-fake') {
      const text = String(data.get('text') || '').trim();
      const at = C.wallToMs(String(data.get('at')));
      if (!text) return;
      state.fakeAnns.push({ id: `fake-${I.hashStr(text + at)}`, text, updatedMs: Number.isFinite(at) ? at : ctx.now(), updatedRaw: 'test', line: CONFIG.line, fake: true });
      LS.set('fakeAnns', state.fakeAnns);
      ctx.recompute();
      ctx.render();
      ctx.toast('Test duyurusu eklendi');
    }
  });

  document.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-dbg], [data-dbg-preset], [data-dbg-sample]');
    if (!el) return;
    if (el.dataset.dbgPreset) {
      ctx.setSim({ baseMs: C.wallToMs(el.dataset.dbgPreset), setAt: Date.now(), running: true });
      ctx.toast('Test saati ayarlandı');
      return;
    }
    if (el.dataset.dbgSample) {
      const ta = document.querySelector('#dbg-fake textarea');
      if (ta) ta.value = SAMPLE_ANNS[+el.dataset.dbgSample];
      return;
    }
    const a = el.dataset.dbg;
    if (a === 'sim-off') {
      ctx.setSim(null);
      ctx.toast('Gerçek saate dönüldü');
    } else if (a === 'probe-plan' || a === 'probe-duyuru') {
      const box = document.getElementById('dbg-probe');
      box.innerHTML = '<p class="muted">Deneniyor…</p>';
      const svc = a === 'probe-plan'
        ? { key: 'plan', url: CONFIG.ibb.planUrl, method: CONFIG.ibb.planMethod, params: { HatKodu: CONFIG.line } }
        : { key: 'duyuru', url: CONFIG.ibb.announceUrl, method: CONFIG.ibb.announceMethod, params: {} };
      const strategies = [...(ctx.proxyUrl() ? ['proxy'] : []), ...I.STRATEGIES];
      const attempts = [];
      for (const s of strategies) {
        const r = await I.callIbb(svc, { ns: CONFIG.ibb.soapNamespace, timeoutMs: CONFIG.ibb.timeoutMs, proxyUrl: ctx.proxyUrl(), only: s });
        attempts.push(...r.attempts);
        box.innerHTML = attemptsTable(ctx, attempts);
      }
      const ok = attempts.find((x) => x.ok);
      box.insertAdjacentHTML('beforeend', ok
        ? `<p class="ok">Çalışan yöntem: ${esc(I.STRATEGY_LABELS[ok.strategy])}. Uygulama bundan sonra önce bunu kullanır.</p>`
        : '<p class="bad">Hiçbir yöntem çalışmadı. Yanıt yoksa ve hata "Erişilemedi" ise büyük ihtimalle tarayıcı engeli (CORS). README\'deki ara sunucu adımına bak.</p>');
      if (ok) LS.set(a === 'probe-plan' ? 'strat.plan' : 'strat.duyuru', ok.strategy);
    } else if (a === 'plan-reset') {
      LS.del('plan');
      LS.del('strat.plan');
      state.km18 = { lists: null, source: 'bundled', fetchedAt: null, strategy: null, mappingBy: null, error: null };
      ctx.recompute();
      ctx.render();
      ctx.toast('Gömülü tarifeye dönüldü');
    } else if (a === 'undismiss') {
      state.dismissed.clear();
      LS.del('dismissed');
      ctx.render();
    } else if (a === 'fake-clear') {
      state.fakeAnns = [];
      LS.del('fakeAnns');
      ctx.recompute();
      ctx.render();
      ctx.toast('Test duyuruları silindi');
    } else if (a === 'check-site') {
      el.disabled = true;
      await ctx.refreshShuttleCheck(true);
      ctx.render();
    } else if (a === 'copy') {
      const ok = await copyText(JSON.stringify(diagnostics(ctx), null, 2));
      ctx.toast(ok ? 'Tanılama panoya kopyalandı' : 'Kopyalanamadı');
    } else if (a === 'hard-reload') {
      try {
        const regs = (await navigator.serviceWorker?.getRegistrations()) || [];
        await Promise.all(regs.map((r) => r.unregister()));
        const keys = (await globalThis.caches?.keys()) || [];
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch { /* yok say */ }
      ['plan', 'ann', 'strat.plan', 'strat.duyuru', 'shuttleCheck'].forEach((k) => LS.del(k));
      location.reload();
    } else if (a === 'lock') {
      LS.del('debugUnlocked');
      ctx.setTab('info');
    }
  });
}

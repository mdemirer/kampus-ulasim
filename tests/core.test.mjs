// Çalıştırma: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  wallToMs, upcoming, dayProgram, buildServices, fmtClock, dateKeyOf, dayLabel, countdown, nightLabel,
} from '../js/core.js';

const shuttle = JSON.parse(readFileSync(new URL('../data/shuttle.json', import.meta.url)));
const km18 = JSON.parse(readFileSync(new URL('../data/km18.json', import.meta.url)));

const svc = (dir, route) => buildServices(shuttle, km18, dir).get(route);
const next = (dir, route, at, opts) => upcoming(svc(dir, route), wallToMs(at), opts);
const show = (trips) => trips.map((t) => `${dateKeyOf(t.ms).slice(5)} ${fmtClock(t.ms)} ${t.kind}${t.cancelled ? ' X' : ''}`);

// 2026-10-05 Pazartesi, 2026-10-09 Cuma, 10 Cumartesi, 11 Pazar, 12 Pazartesi

test('Cuma 23:50 → Kurtköy\'den kampüse sıradaki: Cumartesi 00:45 (Pzt–Per 23:55 Cuma yok)', () => {
  const t = next('toCampus', 'kurtkoy', '2026-10-09T23:50', { count: 2 });
  assert.deepEqual(show(t), ['10-10 00:45 shuttle', '10-10 08:00 shuttle']);
  assert.equal(t[0].reservation, true);
  assert.equal(t[0].night, true);
});

test('Pazartesi 23:50 → 23:55 var, 00:45 yok', () => {
  const t = next('toCampus', 'kurtkoy', '2026-10-05T23:50', { count: 3 });
  assert.deepEqual(show(t), ['10-05 23:55 shuttle', '10-06 07:50 shuttle', '10-06 08:00 iett']);
});

test('Kadıköy gece seferi: Cumartesi 01:30 ve Pazar 01:30 → 02:00; Pazartesi 01:30 → 07:00', () => {
  assert.deepEqual(show(next('toCampus', 'kadikoy', '2026-10-10T01:30', { count: 1 })), ['10-10 02:00 shuttle']);
  assert.deepEqual(show(next('toCampus', 'kadikoy', '2026-10-11T01:30', { count: 1 })), ['10-11 02:00 shuttle']);
  assert.deepEqual(show(next('toCampus', 'kadikoy', '2026-10-12T01:30', { count: 1 })), ['10-12 07:00 shuttle']);
  // Cuma 01:30: Perşembe listesinden 02:00 gelmemeli
  assert.deepEqual(show(next('toCampus', 'kadikoy', '2026-10-09T01:30', { count: 1 })), ['10-09 07:00 shuttle']);
});

test('Pazartesi 15:45 kampüsten Kurtköy: 15:50 (E) atlanır, 15:45 bir dakika boyunca "kalkıyor"', () => {
  const t = next('fromCampus', 'kurtkoy', '2026-10-05T15:45', { count: 3 });
  assert.deepEqual(show(t), ['10-05 15:45 shuttle', '10-05 15:55 iett', '10-05 16:45 shuttle']);
  const t2 = next('fromCampus', 'kurtkoy', '2026-10-05T15:46:30', { count: 1 });
  assert.deepEqual(show(t2), ['10-05 15:55 iett']);
});

test('Cumartesi gün programı gece yarısından sonraki Cuma seferiyle başlar', () => {
  const p = dayProgram(svc('toCampus', 'kurtkoy'), '2026-10-10');
  const sh = p.filter((t) => t.kind === 'shuttle');
  assert.equal(sh[0].time, '00:45');
  assert.equal(sh[0].serviceKey, '2026-10-09');
  assert.equal(sh.length, 11);
  assert.equal(p.filter((t) => t.kind === 'iett').length, 10);
  assert.ok(!sh.some((t) => t.serviceKey === '2026-10-10' && t.time === '00:45'));
});

test('Çekmeköy hafta sonu yok → Cuma akşamından sonra Pazartesi', () => {
  const t = next('fromCampus', 'cekmekoy', '2026-10-09T20:00', { count: 1 });
  assert.deepEqual(show(t), ['10-12 19:40 shuttle']);
  assert.equal(dayLabel(t[0].ms, wallToMs('2026-10-09T20:00')), 'Pazartesi');
});

test('4.Levent pazar 19:40 seferinde Çekmeköy notu yok, hafta içi var', () => {
  const sun = next('fromCampus', 'levent', '2026-10-11T12:00', { count: 1 })[0];
  const mon = next('fromCampus', 'levent', '2026-10-12T19:00', { count: 1 })[0];
  assert.deepEqual(sun.chips, []);
  assert.deepEqual(mon.chips, ["Çekmeköy'e uğrar"]);
});

test('İptal edilen sefer atlanır ama listede işaretli kalır', () => {
  const cancels = new Map([['iett:KM18:toCampus:2026-10-05:16:00', { text: 'test' }]]);
  const t = next('toCampus', 'kurtkoy', '2026-10-05T15:40', { count: 2, cancellations: cancels });
  assert.deepEqual(show(t), ['10-05 16:00 iett X', '10-05 16:15 shuttle', '10-05 16:55 iett']);
});

test('Dönem bitişinden sonraki seferler işaretlenir', () => {
  const t = next('toCampus', 'kurtkoy', '2026-12-31T23:40', { count: 2 });
  assert.equal(t[0].beyondTerm, false);
  assert.equal(t[1].beyondTerm, true);
});

test('Geri sayım ve gece etiketi', () => {
  const now = wallToMs('2026-10-05T10:00');
  assert.deepEqual(countdown(now + 12 * 60000 + 30000, now), { big: '12', unit: 'dk', soon: false });
  assert.equal(countdown(now + 30000, now).big, '<1');
  assert.equal(countdown(now, now).big, 'Kalkıyor');
  assert.equal(countdown(now + 95 * 60000, now).big, '95');
  assert.deepEqual(countdown(now + 236 * 60000, now), { big: '3', unit: 'sa 56 dk', soon: false });
  assert.equal(countdown(now + 11 * 3600000, now).big, null);
  assert.equal(nightLabel('2026-10-09'), "Cuma'yı Cumartesi'ye bağlayan gece");
  assert.equal(nightLabel('2026-10-11'), "Pazar'ı Pazartesi'ye bağlayan gece");
});

test('Favoriler için "bugün" penceresi 04:00–04:00', async () => {
  const { serviceDayWindow, tripsBetween } = await import('../js/core.js');
  assert.equal(serviceDayWindow(wallToMs('2026-10-10T01:30')).key, '2026-10-09');
  assert.equal(serviceDayWindow(wallToMs('2026-10-05T10:00')).key, '2026-10-05');
  const w = serviceDayWindow(wallToMs('2026-10-09T23:50'));
  const trips = tripsBetween(svc('toCampus', 'kadikoy'), w.start, w.end).map((x) => `${dateKeyOf(x.ms).slice(5)} ${x.time}`);
  assert.deepEqual(trips, ['10-09 07:00', '10-09 09:00', '10-09 15:00', '10-10 02:00']);
});

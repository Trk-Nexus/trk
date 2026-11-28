// SPDX-License-Identifier: GPL-3.0-or-later
/* ⏭ 共有フォルダー：対象外のファイルを曲に入れない／再生できない曲で止まらない */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { ROOT } from "./helpers/browser-data.mjs";

const read = rel => fs.readFileSync(`${ROOT}/${rel}`, "utf8");
const mpSrc = read("js/media-player-mode.js"), libSrc = read("js/library.js");
const slice = (src, start, end) => { const a = src.indexOf(start), b = src.indexOf(end, a); assert.ok(a >= 0 && b > a, start); return src.slice(a, b); };

function runStep(songs, playable, opts = {}) {
  const status = [];
  let idx = -1;
  const ctx = vm.createContext({
    core: { currentSong: null, videoReady: false },
    mediaCandidates: () => songs,
    nextMediaSong: () => (songs.length ? songs[(idx = (idx + 1) % songs.length)] : null),
    mediaActive: () => true,
    showMediaStatus: (k, v) => status.push([k, v]),
    playSong: async it => { ctx.core.currentSong = it; ctx.core.videoReady = playable.includes(it.key); if (opts.onPlay) opts.onPlay(ctx, it); },
  });
  vm.runInContext(slice(mpSrc, "const SKIP_UNPLAYABLE_MAX", "\nfunction seekBy(") + "\nglobalThis.stepMedia = stepMedia;", ctx);
  return { ctx, status, run: d => ctx.stepMedia(d) };
}
const S = k => ({ key: k, title: k });

test("next skips unplayable songs and says how many", async () => {
  const songs = [S("bad1"), S("bad2"), S("ok"), S("x")];
  const r = runStep(songs, ["ok", "x"]);
  await r.run(1);
  assert.equal(r.ctx.core.currentSong.key, "ok");
  assert.deepEqual(r.status.at(-1)[0], "mediaSkippedUnplayable");
  assert.equal(r.status.at(-1)[1].n, 2); assert.equal(r.status.at(-1)[1].name, "bad1");
});
test("playable next song: no skip message", async () => {
  const r = runStep([S("ok")], ["ok"]);
  await r.run(1);
  assert.equal(r.status.length, 0);
});
test("all unplayable: stops with the failure reason instead of looping", async () => {
  const songs = Array.from({ length: 30 }, (_, i) => S("b" + i));
  const r = runStep(songs, []);
  await r.run(1);
  assert.equal(r.status.at(-1)[0], "mediaLoadFailed");
  assert.ok(r.ctx.core.currentSong.key === "b9", "最大10曲で止まる");
});
test("user picks another song meanwhile: stop skipping", async () => {
  const other = S("picked");
  const r = runStep([S("bad"), S("bad2")], [], { onPlay: (ctx) => { ctx.core.currentSong = other; } });
  await r.run(1);
  assert.equal(r.ctx.core.currentSong, other);
  assert.equal(r.status.length, 0);
});
test("skip message exists in all 4 languages", () => {
  assert.equal((mpSrc.match(/mediaSkippedUnplayable:"/g) || []).length, 4);
});
test("folder scan ignores dot files / extensionless files and survives a getFile error", () => {
  const scan = slice(libSrc, "async function scanHandle(", "\n/* 🔓");
  assert.match(scan, /n\.startsWith\("\."\) \|\| !n\.includes\("\."\)/);
  assert.match(scan, /try \{ file = await e\.getFile\(\); \} catch \(_\) \{ skipped\+\+; continue; \}/);
});
test("folder scan behaviour (run)", async () => {
  const fn = slice(libSrc, "async function scanHandle(", "\n/* 🔓");
  const ctx = vm.createContext({ MEDIA_EXT: ["mp3", "flac"], CHART_SUFFIX: ".shadow-taiko.json", LIB_DEPTH: 8, LIB_MAX: 3000,
    core: { extOf: p => String(p).split(".").pop().toLowerCase() } });
  vm.runInContext(fn + "\nglobalThis.scanHandle = scanHandle;", ctx);
  const file = (name, bad) => ({ kind: "file", name, getFile: async () => { if (bad) throw new Error("x"); return { name }; } });
  const dir = { name: "M", values: async function* () {
    yield file("a.MP3"); yield file("._a.mp3"); yield file("mp3"); yield file("cover.jpg"); yield file("b.flac", true); yield file("c.flac");
    yield { kind: "directory", name: ".hidden", values: async function* () { yield file("z.mp3"); } };
  } };
  const r = await ctx.scanHandle(dir);
  assert.deepEqual([...r.files].map(f => f.file.name), ["a.MP3", "c.flac"]);
  assert.equal(r.skipped, 4);
});

// Repack the @GoldReward mod after editing anything in _src/GoldReward.
// Run from the @GoldReward folder:  node pack.mjs
// (Optional args: node pack.mjs <srcDir> <out.pbo> <prefix>)
// Builds an uncompressed BI PBO with a raw config.cpp -- no DayZ Tools required.
// After packing, restart the server (Robinhood.Bat) to load the new build.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const srcDir = process.argv[2] ?? "_src/GoldReward";
const outPbo = process.argv[3] ?? "addons/GoldReward.pbo";
const prefix = process.argv[4] ?? "GoldReward";

function walk(dir, base = "") {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + "\\" + e.name : e.name;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(full, rel));
    else if (e.name !== "$PBOPREFIX$") out.push({ rel, data: fs.readFileSync(full) });
  }
  return out;
}

const files = walk(srcDir);
const parts = [];
const strz = (s) => Buffer.concat([Buffer.from(s, "latin1"), Buffer.from([0])]);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; };

parts.push(strz(""), u32(0x56657273), u32(0), u32(0), u32(0), u32(0)); // version entry
parts.push(strz("prefix"), strz(prefix), strz(""));                     // prefix property + end
for (const f of files) parts.push(strz(f.rel), u32(0), u32(f.data.length), u32(0), u32(0), u32(f.data.length));
parts.push(strz(""), u32(0), u32(0), u32(0), u32(0), u32(0));           // header terminator
for (const f of files) parts.push(f.data);                             // body

const body = Buffer.concat(parts);
const out = Buffer.concat([body, Buffer.from([0]), crypto.createHash("sha1").update(body).digest()]);
fs.mkdirSync(path.dirname(outPbo), { recursive: true });
fs.writeFileSync(outPbo, out);
console.log(`wrote ${outPbo} (${out.length} bytes, ${files.length} files, prefix=${prefix})`);

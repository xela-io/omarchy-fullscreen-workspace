const test = require("node:test")
const assert = require("node:assert/strict")
const M = require("../FullscreenModel.js")

function client(address, ws, opts) {
  return Object.assign({
    address: address,
    workspace: { id: ws, name: String(ws) },
    mapped: true,
    hidden: false,
    fullscreen: 0,
    focusHistoryID: 5
  }, opts || {})
}
const active = (address, ws, fullscreen) => client(address, ws, { focusHistoryID: 0, fullscreen: fullscreen })

test("relocates a fullscreen window that shares its workspace", () => {
  const clients = [active("0xaa", 3, 2), client("0xbb", 3)]
  assert.deepEqual(M.decideOnFullscreen(clients, {}), { type: "relocate", address: "0xaa", origin: 3 })
})

test("ignores a fullscreen window that is alone", () => {
  const clients = [active("0xaa", 3, 2), client("0xbb", 4)]
  assert.equal(M.decideOnFullscreen(clients, {}).type, "none")
})

test("hidden or unmapped siblings do not count", () => {
  const clients = [active("0xaa", 3, 2), client("0xbb", 3, { hidden: true }), client("0xcc", 3, { mapped: false })]
  assert.equal(M.decideOnFullscreen(clients, {}).type, "none")
})

test("ignores maximized windows", () => {
  const clients = [active("0xaa", 3, 1), client("0xbb", 3)]
  assert.equal(M.decideOnFullscreen(clients, {}).type, "none")
})

test("ignores special workspaces", () => {
  const clients = [active("0xaa", -98, 2), client("0xbb", -98)]
  assert.equal(M.decideOnFullscreen(clients, {}).type, "none")
})

test("does not relocate an already relocated window again", () => {
  const clients = [active("0xaa", 9, 2), client("0xbb", 9)]
  assert.equal(M.decideOnFullscreen(clients, { "0xaa": { origin: 3 } }).type, "none")
})

test("restores a relocated window that leaves fullscreen", () => {
  const clients = [active("0xaa", 9, 0)]
  assert.deepEqual(M.decideOnFullscreen(clients, { "0xaa": { origin: 3 } }), { type: "restore", address: "0xaa", origin: 3 })
})

test("ignores a non-relocated window that leaves fullscreen", () => {
  assert.equal(M.decideOnFullscreen([active("0xaa", 3, 0)], {}).type, "none")
})

test("no active window means no action", () => {
  assert.equal(M.decideOnFullscreen([client("0xaa", 3, { fullscreen: 2 })], {}).type, "none")
})

test("close returns to origin when the focused workspace is now empty", () => {
  const clients = [client("0xbb", 3)]
  assert.deepEqual(M.decideOnClose("aa", { "0xaa": { origin: 3 } }, clients, 9), { type: "return", address: "0xaa", origin: 3 })
})

test("close only forgets when the focused workspace still has windows", () => {
  const clients = [client("0xcc", 9)]
  assert.deepEqual(M.decideOnClose("0xaa", { "0xaa": { origin: 3 } }, clients, 9), { type: "forget", address: "0xaa" })
})

test("close ignores windows that were never relocated", () => {
  assert.equal(M.decideOnClose("aa", {}, [], 9).type, "none")
})

test("verify re-applies fullscreen when the move dropped it", () => {
  assert.deepEqual(M.decideOnVerify([client("0xaa", 9, { fullscreen: 0 })], "0xaa"), { type: "refullscreen", address: "0xaa" })
})

test("verify does nothing when still fullscreen or gone", () => {
  assert.equal(M.decideOnVerify([client("0xaa", 9, { fullscreen: 2 })], "0xaa").type, "none")
  assert.equal(M.decideOnVerify([], "0xaa").type, "none")
})

test("normalizeAddress adds 0x and lowercases", () => {
  assert.equal(M.normalizeAddress("5BCA41"), "0x5bca41")
  assert.equal(M.normalizeAddress("0x5bca41"), "0x5bca41")
  assert.equal(M.normalizeAddress(""), "")
})

test("parseClients tolerates garbage", () => {
  assert.deepEqual(M.parseClients("not json"), [])
  assert.deepEqual(M.parseClients("{}"), [])
  assert.equal(M.parseClients('[{"address":"0x1"}]').length, 1)
})

test("dispatch strings", () => {
  assert.equal(M.dispatchFor({ type: "relocate" }), 'hl.dsp.window.move({ workspace = "emptym" })')
  assert.equal(M.dispatchFor({ type: "restore", origin: 3 }), 'hl.dsp.window.move({ workspace = "3" })')
  assert.equal(M.dispatchFor({ type: "return", origin: 3 }), 'hl.dsp.focus({ workspace = "3" })')
  assert.equal(M.dispatchFor({ type: "refullscreen" }), 'hl.dsp.window.fullscreen({ mode = "fullscreen" })')
  assert.equal(M.dispatchFor({ type: "forget" }), "")
  assert.equal(M.dispatchFor({ type: "none" }), "")
})

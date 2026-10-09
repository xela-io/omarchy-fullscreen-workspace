const test = require("node:test")
const assert = require("node:assert/strict")
const M = require("../FullscreenModel.js")

function client(address, ws, opts) {
  return Object.assign({
    address: address,
    class: "app",
    workspace: { id: ws, name: String(ws) },
    mapped: true,
    hidden: false,
    fullscreen: 0,
    focusHistoryID: 5
  }, opts || {})
}
const active = (address, ws, fullscreen) => client(address, ws, { focusHistoryID: 0, fullscreen: fullscreen })
const NOW = 100000
const old = (origin) => ({ origin: origin, since: NOW - 10000, repaired: false })

test("relocates a fullscreen window that shares its workspace", () => {
  const clients = [active("0xaa", 3, 2), client("0xbb", 3)]
  assert.deepEqual(M.reconcile(clients, {}, NOW), { type: "relocate", address: "0xaa", origin: 3 })
})

test("relocates a fullscreen window that is not focused (game started in background)", () => {
  const clients = [active("0xbb", 3, 0), client("0xaa", 3, { fullscreen: 2, focusHistoryID: -1 })]
  assert.deepEqual(M.reconcile(clients, {}, NOW), { type: "relocate", address: "0xaa", origin: 3 })
})

test("ignores a fullscreen window that is alone", () => {
  const clients = [active("0xaa", 3, 2), client("0xbb", 4)]
  assert.equal(M.reconcile(clients, {}, NOW).type, "none")
})

test("hidden or unmapped siblings do not count", () => {
  const clients = [active("0xaa", 3, 2), client("0xbb", 3, { hidden: true }), client("0xcc", 3, { mapped: false })]
  assert.equal(M.reconcile(clients, {}, NOW).type, "none")
})

test("ignores maximized windows", () => {
  const clients = [active("0xaa", 3, 1), client("0xbb", 3)]
  assert.equal(M.reconcile(clients, {}, NOW).type, "none")
})

test("ignores special workspaces", () => {
  const clients = [active("0xaa", -98, 2), client("0xbb", -98)]
  assert.equal(M.reconcile(clients, {}, NOW).type, "none")
})

test("never moves the screensaver", () => {
  const ss = { class: "org.omarchy.screensaver" }
  const clients = [
    client("0x51", 1, Object.assign({ fullscreen: 2, focusHistoryID: 0 }, ss)),
    client("0x52", 2, Object.assign({ fullscreen: 2, focusHistoryID: 1 }, ss)),
    client("0xbb", 1), client("0xcc", 2)
  ]
  assert.equal(M.reconcile(clients, {}, NOW).type, "none")
})

test("the screensaver does not count as a sibling of a game", () => {
  const clients = [active("0xaa", 3, 2), client("0x51", 3, { class: "org.omarchy.screensaver", fullscreen: 2 })]
  assert.equal(M.reconcile(clients, {}, NOW).type, "none")
})

test("does not move a settled fullscreen window when a dialog opens next to it", () => {
  const clients = [client("0xaa", 3, { fullscreen: 2, focusHistoryID: 1 }), active("0xdd", 3, 0)]
  assert.equal(M.reconcile(clients, {}, NOW, { "0xaa": true }).type, "none")
})

test("settledFrom collects visible fullscreen windows", () => {
  const clients = [client("0xaa", 3, { fullscreen: 2 }), client("0xbb", 3), client("0xcc", 4, { fullscreen: 2, hidden: true })]
  assert.deepEqual(M.settledFrom(clients), { "0xaa": true })
  assert.deepEqual(M.settledFrom(null), {})
})

test("does not relocate an already relocated window again", () => {
  const clients = [active("0xaa", 9, 2), client("0xbb", 9)]
  assert.equal(M.reconcile(clients, { "0xaa": old(3) }, NOW).type, "none")
})

test("restores a relocated window that leaves fullscreen", () => {
  const clients = [active("0xaa", 9, 0)]
  assert.deepEqual(M.reconcile(clients, { "0xaa": old(3) }, NOW), { type: "restore", address: "0xaa", origin: 3 })
})

test("restores even when the window lost focus before leaving fullscreen", () => {
  const clients = [active("0xbb", 3, 0), client("0xaa", 9, { fullscreen: 0 })]
  assert.deepEqual(M.reconcile(clients, { "0xaa": old(3) }, NOW), { type: "restore", address: "0xaa", origin: 3 })
})

test("re-applies fullscreen once when the move dropped it", () => {
  const fresh = { "0xaa": { origin: 3, since: NOW - 200, repaired: false } }
  assert.deepEqual(M.reconcile([active("0xaa", 9, 0)], fresh, NOW), { type: "refullscreen", address: "0xaa" })
  const repaired = M.nextRelocated(fresh, { type: "refullscreen", address: "0xaa" }, NOW)
  assert.equal(M.reconcile([active("0xaa", 9, 0)], repaired, NOW).type, "none")
  assert.equal(M.reconcile([active("0xaa", 9, 0)], repaired, NOW + M.GRACE_MS).type, "restore")
})

test("forgets relocated windows that disappeared", () => {
  assert.deepEqual(M.reconcile([client("0xbb", 3)], { "0xaa": old(3) }, NOW), { type: "forget", address: "0xaa" })
})

test("failed scan does nothing", () => {
  assert.equal(M.reconcile(null, { "0xaa": old(3) }, NOW).type, "none")
})

test("close returns to origin when the focused workspace is now empty", () => {
  const clients = [client("0xbb", 3)]
  assert.deepEqual(M.decideOnClose("aa", { "0xaa": old(3) }, clients, 9), { type: "return", address: "0xaa", origin: 3 })
})

test("close only forgets when the focused workspace still has windows", () => {
  const clients = [client("0xcc", 9)]
  assert.deepEqual(M.decideOnClose("0xaa", { "0xaa": old(3) }, clients, 9), { type: "forget", address: "0xaa" })
})

test("close only forgets when already on the origin workspace", () => {
  assert.deepEqual(M.decideOnClose("aa", { "0xaa": old(3) }, [client("0xbb", 3)], 3), { type: "forget", address: "0xaa" })
})

test("close ignores windows that were never relocated", () => {
  assert.equal(M.decideOnClose("aa", {}, [], 9).type, "none")
})

test("nextRelocated bookkeeping", () => {
  let r = M.nextRelocated({}, { type: "relocate", address: "0xaa", origin: 3 }, NOW)
  assert.deepEqual(r, { "0xaa": { origin: 3, since: NOW, repaired: false } })
  assert.deepEqual(M.nextRelocated(r, { type: "restore", address: "0xaa", origin: 3 }, NOW), {})
  assert.deepEqual(M.nextRelocated(r, { type: "forget", address: "0xaa" }, NOW), {})
})

test("normalizeAddress adds 0x and lowercases", () => {
  assert.equal(M.normalizeAddress("5BCA41"), "0x5bca41")
  assert.equal(M.normalizeAddress("0x5bca41"), "0x5bca41")
  assert.equal(M.normalizeAddress(""), "")
})

test("parseClients tolerates garbage", () => {
  assert.equal(M.parseClients("not json"), null)
  assert.deepEqual(M.parseClients("{}"), [])
  assert.equal(M.parseClients('[{"address":"0x1"}]').length, 1)
})

test("dispatches target the window by address", () => {
  const w = 'window = "address:0xaa"'
  assert.deepEqual(M.dispatchFor({ type: "relocate", address: "0xaa" }), [
    "hl.dsp.focus({ " + w + " })",
    'hl.dsp.window.move({ workspace = "emptym", ' + w + " })"
  ])
  assert.deepEqual(M.dispatchFor({ type: "restore", address: "0xaa", origin: 3 }), ['hl.dsp.window.move({ workspace = "3", ' + w + " })"])
  assert.deepEqual(M.dispatchFor({ type: "return", address: "0xaa", origin: 3 }), ['hl.dsp.focus({ workspace = "3" })'])
  assert.deepEqual(M.dispatchFor({ type: "refullscreen", address: "0xaa" }), ['hl.dsp.window.fullscreen({ mode = "fullscreen", ' + w + " })"])
  assert.deepEqual(M.dispatchFor({ type: "forget", address: "0xaa" }), [])
})

test("hyprctlCommand uses --batch for several dispatches", () => {
  assert.deepEqual(M.hyprctlCommand([]), [])
  assert.deepEqual(M.hyprctlCommand(["a"]), ["hyprctl", "dispatch", "a"])
  assert.deepEqual(M.hyprctlCommand(["a", "b"]), ["hyprctl", "--batch", "dispatch a ; dispatch b"])
})

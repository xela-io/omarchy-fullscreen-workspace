// Pure decision logic for xela.fullscreen-workspace. No Quickshell imports, so
// the same file is loaded by Service.qml and by `node --test`.
//
// The service does not trust single Hyprland events: a game often requests
// fullscreen before it is mapped or focused, so "the active window" is the wrong
// window at that moment. Instead every relevant event triggers a scan of
// `hyprctl clients` and reconcile() compares that snapshot with what we have
// relocated. It returns at most one action per scan; the service rescans after
// each dispatch until nothing is left to do.

var FULLSCREEN = 2 // hyprctl: 0 = none, 1 = maximized, 2 = fullscreen

// Windows that are fullscreen by design and must never be moved or counted.
// The Omarchy screensaver opens one fullscreen window per monitor.
var EXCLUDED_CLASSES = ["org.omarchy.screensaver"]

// Moving a window can drop its fullscreen state for a moment. Within this
// period after our own move, "not fullscreen" means "re-apply once", not
// "the user left fullscreen".
var GRACE_MS = 1500

function normalizeAddress(address) {
  var a = String(address || "").trim().toLowerCase()
  if (a === "") return ""
  return a.indexOf("0x") === 0 ? a : "0x" + a
}

function parseClients(text) {
  try {
    var parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed : []
  } catch (e) {
    return null // null = scan failed, do nothing
  }
}

function isVisible(c) {
  return !!c && c.mapped !== false && c.hidden !== true && !!c.workspace
}

function isExcluded(c) {
  if (!c) return true
  var cls = String(c["class"] || "")
  var initial = String(c.initialClass || "")
  return EXCLUDED_CLASSES.indexOf(cls) !== -1 || EXCLUDED_CLASSES.indexOf(initial) !== -1
}

function windowsOn(clients, workspaceId, exceptAddress) {
  var n = 0
  for (var i = 0; i < clients.length; i++) {
    var c = clients[i]
    if (!isVisible(c) || isExcluded(c)) continue
    if (normalizeAddress(c.address) === exceptAddress) continue
    if (c.workspace.id === workspaceId) n++
  }
  return n
}

function focusRank(c) {
  return typeof c.focusHistoryID === "number" ? c.focusHistoryID : 1e9
}

// Returns one action: relocate | restore | refullscreen | forget | none.
// `relocated` maps address -> { origin, since, repaired }.
function reconcile(clients, relocated, now, settled) {
  if (!clients) return { type: "none" }
  var present = {}

  // 1. Windows we moved earlier: repair, restore, or keep.
  for (var i = 0; i < clients.length; i++) {
    var c = clients[i]
    if (!c) continue
    var address = normalizeAddress(c.address)
    present[address] = true
    var entry = relocated[address]
    if (!entry || c.fullscreen === FULLSCREEN) continue
    var inGrace = now - (entry.since || 0) < GRACE_MS
    if (inGrace) {
      if (c.fullscreen === 0 && !entry.repaired) return { type: "refullscreen", address: address }
      continue
    }
    if (c.fullscreen === 0) return { type: "restore", address: address, origin: entry.origin }
  }

  // Entries whose window vanished without a closewindow we noticed.
  for (var key in relocated) {
    if (!present[key]) return { type: "forget", address: key }
  }

  // 2. Windows that newly went fullscreen while sharing a workspace. Windows in
  // `settled` were already fullscreen at an earlier scan (alone, or deliberately
  // left), so a dialog opening next to a running game does not move the game.
  var candidates = clients.filter(function(w) {
    return isVisible(w) && !isExcluded(w) && w.fullscreen === FULLSCREEN
  }).sort(function(a, b) { return focusRank(a) - focusRank(b) })

  for (var j = 0; j < candidates.length; j++) {
    var w = candidates[j]
    var addr = normalizeAddress(w.address)
    if (relocated[addr] || (settled && settled[addr])) continue
    if (w.workspace.id <= 0) continue // special workspaces
    if (windowsOn(clients, w.workspace.id, addr) === 0) continue
    return { type: "relocate", address: addr, origin: w.workspace.id }
  }
  return { type: "none" }
}

// Called on `closewindow>>ADDR` (ADDR comes without 0x). `clients` no longer
// contains the closed window.
function decideOnClose(address, relocated, clients, focusedWorkspaceId) {
  var key = normalizeAddress(address)
  var entry = relocated[key]
  if (!entry) return { type: "none" }
  if (!clients || focusedWorkspaceId === entry.origin) return { type: "forget", address: key }
  if (windowsOn(clients, focusedWorkspaceId, key) > 0) return { type: "forget", address: key }
  return { type: "return", address: key, origin: entry.origin }
}

// After a scan without action: every visible fullscreen window counts as
// handled until it leaves fullscreen again.
function settledFrom(clients) {
  var out = {}
  if (!clients) return out
  for (var i = 0; i < clients.length; i++) {
    var c = clients[i]
    if (isVisible(c) && c.fullscreen === FULLSCREEN) out[normalizeAddress(c.address)] = true
  }
  return out
}

function nextRelocated(relocated, action, now) {
  var next = Object.assign({}, relocated)
  if (action.type === "relocate") {
    next[action.address] = { origin: action.origin, since: now, repaired: false }
  } else if (action.type === "refullscreen" && next[action.address]) {
    next[action.address] = Object.assign({}, next[action.address], { repaired: true })
  } else if (action.type === "restore" || action.type === "return" || action.type === "forget") {
    delete next[action.address]
  }
  return next
}

// Returns the list of dispatch expressions (run as one `hyprctl --batch`).
// Every window dispatch targets the window by address, so a focus change
// between scan and dispatch cannot move the wrong window. `emptym` resolves
// against the focused monitor, so relocate focuses the window first; otherwise
// a game on the second monitor would land on the first one.
function dispatchFor(action) {
  var win = 'window = "address:' + (action && action.address) + '"'
  switch (action && action.type) {
    case "relocate": return [
      'hl.dsp.focus({ ' + win + ' })',
      'hl.dsp.window.move({ workspace = "emptym", ' + win + ' })'
    ]
    case "restore": return ['hl.dsp.window.move({ workspace = "' + action.origin + '", ' + win + ' })']
    case "return": return ['hl.dsp.focus({ workspace = "' + action.origin + '" })']
    case "refullscreen": return ['hl.dsp.window.fullscreen({ mode = "fullscreen", ' + win + ' })']
    default: return []
  }
}

function hyprctlCommand(exprs) {
  if (!exprs || exprs.length === 0) return []
  if (exprs.length === 1) return ["hyprctl", "dispatch", exprs[0]]
  return ["hyprctl", "--batch", exprs.map(function(e) { return "dispatch " + e }).join(" ; ")]
}

if (typeof module !== "undefined") {
  module.exports = {
    GRACE_MS: GRACE_MS,
    normalizeAddress: normalizeAddress,
    parseClients: parseClients,
    reconcile: reconcile,
    decideOnClose: decideOnClose,
    settledFrom: settledFrom,
    nextRelocated: nextRelocated,
    dispatchFor: dispatchFor,
    hyprctlCommand: hyprctlCommand
  }
}

// Pure decision logic for xela.fullscreen-workspace. No Quickshell imports, so
// the same file is loaded by Service.qml and by `node --test`.

var FULLSCREEN = 2 // hyprctl: 0 = none, 1 = maximized, 2 = fullscreen

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
    return []
  }
}

function isVisible(c) {
  return !!c && c.mapped !== false && c.hidden !== true && !!c.workspace
}

function activeClient(clients) {
  for (var i = 0; i < clients.length; i++) {
    if (clients[i] && clients[i].focusHistoryID === 0) return clients[i]
  }
  return null
}

function windowsOn(clients, workspaceId, exceptAddress) {
  var n = 0
  for (var i = 0; i < clients.length; i++) {
    var c = clients[i]
    if (!isVisible(c)) continue
    if (normalizeAddress(c.address) === exceptAddress) continue
    if (c.workspace.id === workspaceId) n++
  }
  return n
}

// Called on every Hyprland `fullscreen` event. The event itself only says 0/1,
// so the active client's `fullscreen` field decides (maximized is 1, ignored).
function decideOnFullscreen(clients, relocated) {
  var active = activeClient(clients)
  if (!active || !active.workspace) return { type: "none" }
  var address = normalizeAddress(active.address)
  var entry = relocated[address]

  if (active.fullscreen === FULLSCREEN) {
    if (entry) return { type: "none" }
    if (active.workspace.id < 0) return { type: "none" }
    if (windowsOn(clients, active.workspace.id, address) === 0) return { type: "none" }
    return { type: "relocate", address: address, origin: active.workspace.id }
  }

  if (active.fullscreen === 0 && entry) {
    return { type: "restore", address: address, origin: entry.origin }
  }
  return { type: "none" }
}

// Called on `closewindow>>ADDR` (ADDR comes without 0x). `clients` no longer
// contains the closed window.
function decideOnClose(address, relocated, clients, focusedWorkspaceId) {
  var key = normalizeAddress(address)
  var entry = relocated[key]
  if (!entry) return { type: "none" }
  if (windowsOn(clients, focusedWorkspaceId, key) > 0) return { type: "forget", address: key }
  return { type: "return", address: key, origin: entry.origin }
}

// Called shortly after our own move, because moving may drop fullscreen.
function decideOnVerify(clients, address) {
  var key = normalizeAddress(address)
  for (var i = 0; i < clients.length; i++) {
    var c = clients[i]
    if (c && normalizeAddress(c.address) === key) {
      return c.fullscreen === FULLSCREEN ? { type: "none" } : { type: "refullscreen", address: key }
    }
  }
  return { type: "none" }
}

function dispatchFor(action) {
  switch (action && action.type) {
    case "relocate": return 'hl.dsp.window.move({ workspace = "emptym" })'
    case "restore": return 'hl.dsp.window.move({ workspace = "' + action.origin + '" })'
    case "return": return 'hl.dsp.focus({ workspace = "' + action.origin + '" })'
    case "refullscreen": return 'hl.dsp.window.fullscreen({ mode = "fullscreen" })'
    default: return ""
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    normalizeAddress: normalizeAddress,
    parseClients: parseClients,
    decideOnFullscreen: decideOnFullscreen,
    decideOnClose: decideOnClose,
    decideOnVerify: decideOnVerify,
    dispatchFor: dispatchFor
  }
}

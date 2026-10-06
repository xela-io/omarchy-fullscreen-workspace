import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import "FullscreenModel.js" as Model

// Glue only: every decision lives in FullscreenModel.js (unit-tested with node).
Item {
  id: root

  // Injected by omarchy-shell; unused, declared so the loader can set it.
  property var shell: null

  // address -> { origin: workspaceId }. In memory only; a shell restart forgets it.
  property var relocated: ({})
  property var queue: []
  property var current: null
  // Our own dispatches raise `fullscreen` events; ignore them until this time.
  property double busyUntil: 0

  function log(msg) { console.log("xela.fullscreen-workspace " + msg) }

  function request(kind, address) {
    root.queue = root.queue.concat([{ kind: kind, address: address || "" }])
    pump()
  }

  function pump() {
    if (clientsProc.running || root.current !== null || root.queue.length === 0) return
    root.current = root.queue[0]
    root.queue = root.queue.slice(1)
    clientsProc.running = true
  }

  function handle(text) {
    var req = root.current
    root.current = null
    if (req) {
      var clients = Model.parseClients(text)
      var action = { type: "none" }
      if (req.kind === "fullscreen") {
        action = Model.decideOnFullscreen(clients, root.relocated)
      } else if (req.kind === "close") {
        var focused = Hyprland.focusedWorkspace ? Hyprland.focusedWorkspace.id : -1
        action = Model.decideOnClose(req.address, root.relocated, clients, focused)
      } else if (req.kind === "verify") {
        action = Model.decideOnVerify(clients, req.address)
      }
      apply(action)
    }
    Qt.callLater(root.pump)
  }

  function apply(action) {
    if (!action || action.type === "none") return
    log(action.type + " " + action.address + (action.origin !== undefined ? " origin=" + action.origin : ""))

    var next = Object.assign({}, root.relocated)
    if (action.type === "relocate") {
      next[action.address] = { origin: action.origin }
    } else if (action.type !== "refullscreen") {
      delete next[action.address]
    }
    root.relocated = next

    var expr = Model.dispatchFor(action)
    if (expr === "") return
    root.busyUntil = Date.now() + 500
    Quickshell.execDetached(["hyprctl", "dispatch", expr])

    if (action.type === "relocate") {
      verifyTimer.address = action.address
      verifyTimer.restart()
    }
  }

  Timer {
    id: verifyTimer
    property string address: ""
    interval: 300
    onTriggered: root.request("verify", address)
  }

  Process {
    id: clientsProc
    command: ["hyprctl", "-j", "clients"]
    stdout: StdioCollector { onStreamFinished: root.handle(text) }
    onExited: function(exitCode, exitStatus) {
      if (exitCode !== 0) {
        root.log("hyprctl clients failed exitCode=" + exitCode)
        root.current = null
        Qt.callLater(root.pump)
      }
    }
  }

  Connections {
    target: Hyprland
    function onRawEvent(event) {
      if (!event || !event.name) return
      var name = String(event.name)
      if (name === "fullscreen") {
        if (Date.now() < root.busyUntil) return
        root.request("fullscreen", "")
      } else if (name === "closewindow") {
        root.request("close", String(event.data || ""))
      }
    }
  }

  Component.onCompleted: log("started")
}

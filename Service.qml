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

  // address -> { origin, since, repaired }. In memory only; a shell restart forgets it.
  property var relocated: ({})
  // Pending closewindow addresses; handled on the next scan before reconcile.
  property var closed: []
  property bool rescan: false
  // address -> true for fullscreen windows already handled; see Model.settledFrom.
  property var settled: ({})

  function log(msg) { console.log("xela.fullscreen-workspace " + msg) }

  // Coalesces bursts of events (open + fullscreen + focus) into one scan.
  // A throttle, not a debounce: a window that changes its title constantly
  // (browser progress, players) emits activewindowv2 every few ms and would
  // otherwise postpone the scan forever.
  function schedule() {
    if (clientsProc.running) { root.rescan = true; return }
    if (!debounce.running) debounce.start()
  }

  function scanFinished() {
    if (root.rescan) { root.rescan = false; schedule() }
  }

  function handle(text) {
    var clients = Model.parseClients(text)
    var now = Date.now()
    var action = { type: "none" }

    while (root.closed.length > 0 && action.type === "none") {
      var address = root.closed[0]
      root.closed = root.closed.slice(1)
      var focused = Hyprland.focusedWorkspace ? Hyprland.focusedWorkspace.id : -1
      action = Model.decideOnClose(address, root.relocated, clients, focused)
    }
    if (action.type === "none") action = Model.reconcile(clients, root.relocated, now, root.settled)

    if (action.type === "none") {
      root.settled = Model.settledFrom(clients)
    } else {
      log(action.type + " " + action.address + (action.origin !== undefined ? " origin=" + action.origin : ""))
      root.relocated = Model.nextRelocated(root.relocated, action, now)
      var cmd = Model.hyprctlCommand(Model.dispatchFor(action))
      if (cmd.length > 0) Quickshell.execDetached(cmd)
      root.rescan = true
    }
    // A relocated window inside its grace period needs one more look later.
    if (Object.keys(root.relocated).length > 0) graceCheck.restart()
    Qt.callLater(root.scanFinished)
  }

  Timer {
    id: debounce
    interval: 120
    onTriggered: clientsProc.running = true
  }

  Timer {
    id: lateCheck
    interval: 1500
    onTriggered: root.schedule()
  }

  Timer {
    id: graceCheck
    interval: Model.GRACE_MS + 100
    onTriggered: root.schedule()
  }

  Process {
    id: clientsProc
    command: ["hyprctl", "-j", "clients"]
    stdout: StdioCollector { onStreamFinished: root.handle(text) }
    onExited: function(exitCode, exitStatus) {
      if (exitCode !== 0) root.log("hyprctl clients failed exitCode=" + exitCode)
      Qt.callLater(root.scanFinished)
    }
  }

  Connections {
    target: Hyprland
    function onRawEvent(event) {
      if (!event || !event.name) return
      var name = String(event.name)
      if (name === "closewindow") {
        root.closed = root.closed.concat([String(event.data || "")])
        root.schedule()
      } else if (name === "openwindow") {
        // Games often switch to fullscreen a moment after mapping.
        root.schedule()
        lateCheck.restart()
      } else if (name === "fullscreen" || name === "movewindowv2" || name === "changefloatingmode") {
        root.schedule()
      }
    }
  }

  Component.onCompleted: { log("started"); schedule() }
}

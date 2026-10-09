# Fullscreen Workspace (Omarchy shell service)

When a window goes fullscreen (`SUPER+F`) while sharing its workspace with other
windows, it is moved to an empty workspace on the same monitor. Leaving
fullscreen moves it back; closing it while relocated returns you to the
original workspace. Maximized windows (`SUPER+ALT+F`), special workspaces and
windows that are already alone are left alone.

The Omarchy screensaver (`org.omarchy.screensaver`) is never moved and never
counts as a neighbour. The service does not rely on the focused window: on every
`openwindow`/`fullscreen`/`movewindowv2`/`closewindow` event it scans
`hyprctl clients` and reconciles, so games that go fullscreen before they get
focus, or on the second monitor, are caught too. All dispatches address the
window directly (`window = "address:…"`).

## Install

    omarchy plugin add https://github.com/xela-io/omarchy-fullscreen-workspace.git --enable

## Develop

    node --test tests/*.test.js

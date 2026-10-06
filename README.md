# Fullscreen Workspace (Omarchy shell service)

When a window goes fullscreen (`SUPER+F`) while sharing its workspace with other
windows, it is moved to an empty workspace on the same monitor. Leaving
fullscreen moves it back; closing it while relocated returns you to the
original workspace. Maximized windows (`SUPER+ALT+F`), special workspaces and
windows that are already alone are left alone.

## Install

    omarchy plugin add https://github.com/xela-io/omarchy-fullscreen-workspace.git --enable

## Develop

    node --test tests/*.test.js

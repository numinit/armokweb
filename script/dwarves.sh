#!/bin/sh

DIR="$(dirname "$0")"
LOG="$DIR/dwarves.log"

# HACK: what the fuck, we need to remap this so '<' and '>' aren't both '>'
echo "Fixing keymap..."
xmodmap -e 'keycode 94 = brokenbar'

# Start DF
echo "Starting Dwarf Fortress..."
#dwarf-fortress 2>&1 &
script -c dfhack /dev/stdout &
df_pid=$!

# Therapist needs an absolute path to the install directory
echo "Starting Dwarf Therapist..."
dwarftherapist &
dt_pid=$!

# Start a debug console
xterm -T "Console" -e tail -fn1000 "$LOG" &

# Wait for things to quit
wait "$df_pid"
echo "Dwarf Fortress exited; close this debug console to restart it."
wait
